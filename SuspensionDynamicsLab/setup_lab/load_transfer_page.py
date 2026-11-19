"""Quasi-static load transfer and tire analysis pages."""

import math
import tkinter as tk
from tkinter import filedialog, ttk

import numpy as np

from .chart_base import COLORS, Chart
from .lateral_tire import DEFAULT_TIR, import_tir
from .load_transfer import TransferDistribution, contact_patch
from .project import CONTACT_FIELDS, CORNERS, TIRE_ANALYSIS_FIELDS, TRANSFER_FIELDS, default_project, transfer_options
from .widgets import entry


def field_values(fields):
    try:
        return {key: float(var.get()) for key, var in fields.items()}
    except ValueError as exc:
        raise ValueError("設定欄位須填入數值。") from exc


def current_distribution(app, options):
    case = {**default_project()["case"], "target": "all"}
    project = app.collect(app.analysis_pages["full"], case=case)
    return TransferDistribution(project, options)


def result_table(parent, headers, height, *, widths=None):
    table = ttk.Treeview(parent, columns=headers, show="headings", height=height)
    for name, width in zip(headers, widths or (118,) * len(headers)):
        table.heading(name, text=name)
        table.column(name, width=width, minwidth=min(width, 64), anchor="center")
    table.pack(fill="x", pady=(0, 4))
    return table


def add_charts(views, names):
    charts = {}
    for name in names:
        chart = charts[name] = Chart(views)
        chart.canvas.configure(width=600, height=260)
        views.add(chart, text=name)
    return charts


def number(value, digits=1):
    return "—" if value is None else f"{value:.{digits}f}"


def plot(chart, title, x, curves, unit):
    series = [{"name": name, "color": COLORS[i % len(COLORS)], "x": x, "y": list(y)}
              for i, (name, y) in enumerate(curves)]
    chart.set(dict(title=title, xlabel="側向加速度 (g)", ylabel=unit, series=series))


def sweep_accelerations(ay, lift_limit):
    bound = max(min(2.5, float(lift_limit)), abs(ay), .05)
    return np.unique(np.r_[np.linspace(-bound, bound, 81), ay]).tolist()


class LoadTransferPage(ttk.Frame):
    def __init__(self, app):
        super().__init__(app.pages, padding=10)
        self.app = app
        self.fields = {}
        setup = ttk.LabelFrame(self, text="載重轉移工況", padding=8)
        setup.pack(fill="x")
        for i, key in enumerate(("ay", "radius", "height_f", "height_r")):
            label = TRANSFER_FIELDS[key][0]
            variable = self.fields[key] = tk.StringVar()
            entry(setup, i // 2, 2 * (i % 2), label, variable, width=8)
        ttk.Button(setup, text="更新計算", command=self.draw).grid(row=2, column=0, sticky="w", pady=(4, 0))
        ttk.Label(setup, text="正 ay 為左轉").grid(row=2, column=1, columnspan=3, sticky="w")
        self.readout = ttk.Label(self, justify="left", padding=(0, 6))
        self.readout.pack(anchor="w", fill="x")
        self.views = ttk.Notebook(self)
        self.views.pack(fill="both", expand=True, pady=(6, 0))
        tables = ttk.Frame(self.views, padding=8)
        self.views.add(tables, text="計算明細")
        self.wheels = result_table(tables, ("輪位", "基準輪荷 (N)", "輪荷 (N)"), 4)
        self.paths = result_table(tables, ("力矩路徑", "前軸 (N·m)", "後軸 (N·m)"), 3)
        self.balance = ttk.Label(tables, justify="left")
        self.balance.pack(anchor="w", pady=(4, 0))
        self.charts = add_charts(self.views, ("輪荷", "側傾", "載重轉移分配", "三路徑力矩"))
        self.views.select(self.charts["輪荷"])

    def set_options(self, values):
        for key, variable in self.fields.items():
            variable.set(values[key])
        self.clear()

    def options(self):
        return transfer_options(field_values(self.fields))

    def clear(self):
        self.readout.configure(text="")
        self.balance.configure(text="")
        for table in (self.wheels, self.paths):
            table.delete(*table.get_children())
        for chart in self.charts.values():
            chart.set(None)

    def draw(self):
        self.clear()
        try:
            options = self.options()
            model = current_distribution(self.app, options)
            self.draw_distribution(model, options["ay"])
        except ValueError as exc:
            self.clear()
            self.readout.configure(text=str(exc))

    def draw_distribution(self, model, ay):
        data = model.load_state(ay)
        for corner, baseline, load in zip(CORNERS, data["baseline"], data["loads"]):
            self.wheels.insert("", "end", values=(corner, number(baseline), number(load)))
        for label, row in zip(("簧下", "幾何", "彈性"), data["paths"]):
            self.paths.insert("", "end", values=(label, *(number(value) for value in row)))
        first_lift = int(np.argmin(model.lift_limits_g))
        lift_limit = model.lift_limits_g[first_lift]
        lift_label = f"{('前軸', '後軸')[first_lift]} {lift_limit:.2f} g" if math.isfinite(lift_limit) else "—"
        moment_share = data["front_moment_share"]
        moment_label = number(None if moment_share is None else 100 * moment_share)
        self.balance.configure(text=(
            f"前軸力矩占比 {moment_label}%　｜　力矩平衡誤差 {data['moment_error']:.3g} N·m\n"
            f"前／後側傾剛性 {model.roll_stiffness[0]:.1f}／{model.roll_stiffness[1]:.1f} N·m/rad"
            f"　｜　側傾梯度 {model.roll_gradient:.3f}°/g\n"
            f"前／後靜態 Roll Center {model.rc[0]*1000:.1f}／{model.rc[1]*1000:.1f} mm\n"
            f"無空力首個抬輪門檻 {lift_label}"))
        lift = "、".join(corner for corner, load in zip(CORNERS, data["loads"]) if load <= 0)
        note = f"　｜　抬輪：{lift}" if lift else ""
        front_share = number(None if data["front_share"] is None else 100 * data["front_share"])
        self.readout.configure(text=(
            f"前軸 LLTD {front_share}%　｜　側傾 {data['roll']:.3f}°　｜　車速 {data['speed_kmh']:.1f} km/h{note}"))
        x = sweep_accelerations(ay, lift_limit)
        scan = [model.load_state(value) for value in x]
        plot(self.charts["輪荷"], "輪荷", x, zip(CORNERS, np.array([d["loads"] for d in scan]).T), "輪荷 (N)")
        plot(self.charts["側傾"], "側傾", x, [("側傾", [d["roll"] for d in scan])], "側傾角 (°)")
        plot(self.charts["載重轉移分配"], "載重轉移分配", x,
             zip(("前軸 ΔF", "後軸 ΔF"), np.array([d["lateral"] for d in scan]).T), "內輪移至外輪 (N)")
        path_names = [f"{axle} {path}" for path in ("簧下", "幾何", "彈性") for axle in ("前軸", "後軸")]
        plot(self.charts["三路徑力矩"], "三路徑力矩", x,
             zip(path_names, np.array([d["paths"].flatten() for d in scan]).T), "力矩 (N·m)")


class TireAnalysisPage(ttk.Frame):
    def __init__(self, app, transfer_page):
        super().__init__(app.pages, padding=10)
        self.app = app
        self.transfer_page = transfer_page
        self.contact_model = None
        self.fields = {key: transfer_page.fields[key] for key in ("ay", "radius")}
        setup = ttk.LabelFrame(self, text="工況與輪胎參數", padding=8)
        setup.pack(fill="x")
        for i, key in enumerate(("ay", "radius")):
            entry(setup, 0, 2 * i, TRANSFER_FIELDS[key][0], self.fields[key], width=8)
        for i, (key, (label, *_)) in enumerate(TIRE_ANALYSIS_FIELDS.items()):
            variable = self.fields[key] = tk.StringVar()
            entry(setup, 1, 2 * i, label, variable, width=8)
        tire = ttk.Frame(setup)
        tire.grid(row=2, column=0, columnspan=6, sticky="w", pady=(4, 0))
        self.tir_source = None
        self.tir_name = tk.StringVar(value=DEFAULT_TIR)
        ttk.Label(tire, text="前後軸 TIR").pack(side="left", padx=(0, 6))
        ttk.Entry(tire, textvariable=self.tir_name, state="readonly", width=42).pack(side="left", padx=(0, 6))
        ttk.Button(tire, text="匯入 .tir", command=self.choose_tir).pack(side="left", padx=(0, 6))
        self.tir_reset = ttk.Button(tire, text="恢復預設", command=self.reset_tir, state="disabled")
        self.tir_reset.pack(side="left")
        ttk.Button(setup, text="更新計算", command=self.draw).grid(row=3, column=0, sticky="w", pady=(4, 0))
        ttk.Label(setup, text="Slip Ratio 前後軸共用，正值驅動，負值煞車").grid(
            row=3, column=1, columnspan=5, sticky="w")
        self.readout = ttk.Label(self, justify="left", padding=(0, 6))
        self.readout.pack(anchor="w", fill="x")
        self.views = ttk.Notebook(self)
        self.views.pack(fill="both", expand=True, pady=(6, 0))
        tables = ttk.Frame(self.views, padding=8)
        self.views.add(tables, text="計算明細")
        headers = ("輪位", "輪荷 (N)", "側向力 (N)", "滑角 (°)")
        self.wheels = result_table(tables, headers, 4)
        self.charts = add_charts(self.views, ("穩態轉向", "不足轉向", "抓地"))
        self.build_contact_view()
        self.views.select(self.charts["穩態轉向"])

    def build_contact_view(self):
        self.contact_view = view = ttk.Frame(self.views, padding=8)
        self.views.add(view, text="接地面")
        controls = ttk.Frame(view)
        controls.pack(fill="x", pady=(0, 6))
        ttk.Label(controls, text="預覽側向加速度 (g)").pack(side="left", padx=(0, 8))
        _, _, low, high = TRANSFER_FIELDS["ay"]
        self.contact_ay = tk.DoubleVar()
        self.contact_slider = ttk.Scale(controls, from_=low, to=high, variable=self.contact_ay,
                                       command=self.update_contact)
        self.contact_slider.pack(side="left", fill="x", expand=True)
        self.contact_label = ttk.Label(controls, width=9, anchor="e")
        self.contact_label.pack(side="left")

        sidebar = ttk.Frame(view)
        sidebar.pack(side="right", fill="y", padx=(8, 0))
        tires = ttk.LabelFrame(sidebar, text="接地面參數", padding=6)
        tires.pack(fill="x", pady=(0, 8))
        for row, (key, (label, *_)) in enumerate(CONTACT_FIELDS.items()):
            variable = self.fields[key] = tk.StringVar()
            entry(tires, row, 0, label, variable, width=8)
        headers = ("輪位", "輪荷 (N)", "面積 (cm²)", "長 (mm)", "寬 (mm)")
        self.contact_wheels = result_table(sidebar, headers, 4, widths=(45, 68, 76, 62, 62))
        self.contact_readout = ttk.Label(sidebar, justify="left")
        self.contact_readout.pack(anchor="w")
        chart = self.charts["接地面"] = Chart(view)
        chart.canvas.configure(width=530, height=260)
        chart.pack(fill="both", expand=True)
        self.contact_angles = np.linspace(0., 2 * math.pi, 65)

    def set_options(self, values):
        for key, variable in self.fields.items():
            variable.set(values[key])
        self.set_tir(values.get("tire_tir"))
        self.clear()

    def set_tir(self, source):
        self.tir_source = source
        self.tir_name.set(source["name"] if source else DEFAULT_TIR)
        self.tir_reset.state(["!disabled"] if source else ["disabled"])

    def choose_tir(self):
        path = filedialog.askopenfilename(parent=self, title="匯入 MF6.1 TIR", filetypes=[("TIR", "*.tir")])
        if not path:
            return
        try:
            source = import_tir(path)
        except (OSError, ValueError) as exc:
            self.app.error(exc)
            return
        self.set_tir(source)
        self.draw()

    def reset_tir(self):
        self.set_tir(None)
        self.draw()

    def options(self):
        values = field_values(self.transfer_page.fields | self.fields)
        if self.tir_source is not None:
            values["tire_tir"] = self.tir_source
        return transfer_options(values)

    def clear(self):
        self.readout.configure(text="")
        for table in (self.wheels, self.contact_wheels):
            table.delete(*table.get_children())
        self.contact_label.configure(text="")
        self.contact_readout.configure(text="")
        self.contact_model = None
        self.contact_slider.state(["disabled"])
        for chart in self.charts.values():
            chart.set(None)

    def draw(self):
        self.clear()
        try:
            options = self.options()
            model = current_distribution(self.app, options)
            self.set_contact_model(model, options["ay"])
            self.draw_tire_results(model, options["ay"])
        except ValueError as exc:
            self.readout.configure(text=str(exc))

    def set_contact_model(self, model, ay):
        self.contact_model = model
        _, _, low, high = TRANSFER_FIELDS["ay"]
        # With the current aero law, wheel loads are linear on either side of zero g.
        peak_loads = np.max([model.load_state(g)["loads"] for g in (low, 0., high)], axis=0)
        patches = self.contact_patches(peak_loads)
        half_length = max(length / 2 for _, length, _ in patches)
        half_span = max(track * 500 + width / 2 for track, (_, _, width) in zip(np.repeat(model.track, 2), patches))
        self.contact_bounds = (-model.wheelbase * 1000 - half_length, half_length, -half_span, half_span)
        self.contact_ay.set(ay)
        self.contact_slider.state(["!disabled"])
        self.update_contact(ay)

    def contact_patches(self, loads):
        options = self.contact_model.options
        return [contact_patch(load, options[f"pressure_{axle}"], options[f"width_{axle}"])
                for load, axle in zip(loads, ("f", "f", "r", "r"))]

    def update_contact(self, value):
        model = self.contact_model
        if model is None:
            return
        ay = float(value)
        self.contact_label.configure(text=f"{ay:+.2f} g")
        data = model.load_state(ay)
        loads = data["loads"]
        self.contact_wheels.delete(*self.contact_wheels.get_children())
        series = []
        for i, (corner, load, (area, length, width)) in enumerate(zip(CORNERS, loads, self.contact_patches(loads))):
            self.contact_wheels.insert("", "end", values=(corner, *(number(v) for v in (load, area, length, width))))
            x = 0. if i < 2 else -1000 * model.wheelbase
            y = (1 if i % 2 == 0 else -1) * 500 * model.track[i // 2]
            series.append({"name": corner, "x": (x + length / 2 * np.cos(self.contact_angles)).tolist() if width else [x],
                           "y": (y + width / 2 * np.sin(self.contact_angles)).tolist() if width else [y],
                           "marker": "x" if width == 0 else False})
        lift = "、".join(corner for corner, load in zip(CORNERS, loads) if load <= 0)
        front, rear = data["lateral"]
        self.contact_readout.configure(text=f"前軸轉移量 {front:+.1f} N\n後軸轉移量 {rear:+.1f} N"
                                           + (f"\n抬輪 {lift}" if lift else ""))
        self.charts["接地面"].set(dict(title="接地面橢圓", xlabel="縱向，向前為正 (mm)", ylabel="橫向，向左為正 (mm)",
                                      equal=True, fit_bounds=self.contact_bounds, series=series), keep_view=True)

    def draw_tire_results(self, model, ay):
        data = model.at(ay)
        x = sweep_accelerations(ay, min(model.lift_limits_g))
        scan = [model.at(value) for value in x]
        for i, corner in enumerate(CORNERS):
            values = (data["loads"][i], data["forces"][i], data["slips"][i // 2])
            self.wheels.insert("", "end", values=(corner, *(number(value) for value in values)))
        grip = "／".join("—" if value is None else f"{value:.1%}" for value in data["grip"])
        self.readout.configure(text=(
            f"前／後相對抓地 {grip}　｜　轉向 {number(data['steer'], 2)}°"
            f"　｜　不足轉向 {number(data['understeer'], 2)}°/g"))
        plot(self.charts["穩態轉向"], "穩態轉向", x, [("穩態轉向", [d["steer"] for d in scan])], "轉向角 (°)")
        plot(self.charts["不足轉向"], "不足轉向", x, [("不足轉向梯度", [d["understeer"] for d in scan])], "梯度 (°/g)")
        grip_percent = [[None if d["grip"][i] is None else 100 * d["grip"][i] for d in scan] for i in range(2)]
        plot(self.charts["抓地"], "抓地", x, zip(("前軸", "後軸"), grip_percent), "相對抓地 (%)")
