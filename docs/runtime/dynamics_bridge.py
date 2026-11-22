"""Serialise the desktop suspension solver for the static site's worker."""

from copy import deepcopy
from dataclasses import asdict
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory

import numpy as np

from setup_lab.components import KCSystem
from setup_lab.engine import prepare_simulation, prepare_vehicle, simulate, wheel_travel_threshold
from setup_lab.geometry_lookup import read_csv as read_geometry_csv
from setup_lab.load_transfer import TransferDistribution
from setup_lab.project import (
    CHANNELS, CORNERS, MODEL_PAGE, analysis_page_cases, compile_project, damping_reference_mass, default_project,
    load_transfer_options, open_project, read_force_csv, read_recording, transfer_options,
)
from setup_lab.roll_center_scan import scan_roll_center
from setup_lab.simulation_export import export_simulation


LABELS = {
    "全車懸吊調校": "Full Vehicle Setup", "車身姿態": "Body attitude", "車身": "Body",
    "前軸升沉": "Front heave", "後軸升沉": "Rear heave", "前軸側傾": "Front roll",
    "後軸側傾": "Rear roll", "前後同向側傾": "Coupled roll", "對角扭擺": "Diagonal warp", "直推": "Direct acting",
    "升沉加速度": "Heave acceleration", "升沉速度": "Heave velocity", "升沉": "Heave", "俯仰": "Pitch",
    "前側傾": "Front roll", "後側傾": "Rear roll", "側傾": "Roll", "車架扭角": "Chassis twist",
    "車架扭矩": "Chassis torque", "角速度": " angular velocity", "角加速度": " angular acceleration",
    "輸入": "Inputs", "縱向加速度": "Longitudinal acceleration", "側向加速度": "Lateral acceleration",
    "前 Roll Center": "Front roll center", "後 Roll Center": "Rear roll center",
    "煞車前 Anti-dive": "Front anti-dive under braking", "煞車後 Anti-lift": "Rear anti-lift under braking",
    "加速前 Anti-lift": "Front anti-lift under acceleration", "加速後 Anti-squat": "Rear anti-squat under acceleration",
    "空力": "Aerodynamics", "全車下壓力": "Vehicle downforce", "模型承受下壓力": "Model downforce",
    "車架傳力": "Chassis force path", "Roll Center 指令": "Roll center target force", "Roll Center 傳遞力": "Roll center transmitted force",
    "載重轉移量": "Load transfer", "載重轉移速率": "Load transfer rate",
    "幾何載重轉移量": "Geometric load transfer", "幾何載重轉移速率": "Geometric load transfer rate",
    "懸吊載重轉移量": "Suspension load transfer", "懸吊載重轉移速率": "Suspension load transfer rate",
    "路徑合計載重轉移量": "Combined path load transfer", "路徑合計載重轉移速率": "Combined path load transfer rate",
    "輪胎端載重轉移量": "Tire contact load transfer", "輪胎端載重轉移速率": "Tire contact load transfer rate",
    "幾何": "Geometric", "懸吊": "Suspension", "路徑合計": "Combined paths", "輪胎端": "Tire contact",
    "輪荷": "Wheel loads", "輪端行程": "Wheel travel", "輪端懸吊力": "Wheel suspension forces",
    "輪端位移": "Wheel displacement", "ISO 路面": "ISO road", "路面高度": "Road height", "路面速度": "Road velocity", "路面": "Road",
    "輪端垂直速度": "Wheel vertical velocity", "輪端垂直加速度": "Wheel vertical acceleration",
    "簧上位移": "Sprung-mass displacement", "簧上垂直速度": "Sprung-mass vertical velocity",
    "簧上垂直加速度": "Sprung-mass vertical acceleration", "車速": "Vehicle speed",
    "模態／輪端反力": "Reaction force", "軸心行程": "Shaft travel", "軸心速度": "Shaft speed",
    "彈簧力": "Spring force", "阻尼力": "Damper force", "限位塊力": "Travel stop force",
}

FIELD_LABELS = {
    "總質量": "Total mass", "重心至前軸": "CG distance to front axle", "重心至後軸": "CG distance to rear axle",
    "前輪距": "Front track", "後輪距": "Rear track", "重心高度": "CG height", "簧上質量": "Sprung mass",
    "簧上側傾慣量": "Sprung roll inertia", "簧上俯仰慣量": "Sprung pitch inertia", "前側傾中心高度": "Front roll center height",
    "後側傾中心高度": "Rear roll center height", "車架扭轉剛性": "Chassis torsional stiffness", "車架扭轉阻尼": "Chassis torsional damping",
    "輪胎自由半徑": "Free tire radius", "輪胎工作半徑": "Tire working radius",
    "簧下質量": "Unsprung mass", "輪端剛性": "Wheel-end stiffness", "輪端阻尼": "Wheel-end damping",
    "模擬時間": "Simulation duration", "輸出間隔": "Output interval", "輸入開始": "Input start", "凸塊高度": "Bump height",
    "通過凸塊時間": "Bump traversal time", "路面隨機種子": "Road seed", "加速度上升時間": "Acceleration ramp time",
    "車架等效剛性": "Equivalent chassis stiffness", "車架等效阻尼": "Equivalent chassis damping", "車架等效慣性質量": "Equivalent chassis mass",
    "參考車速": "Reference speed", "參考下壓力": "Reference downforce", "比例": "ratio", "前胎壓": "Front tire pressure",
    "後胎壓": "Rear tire pressure", "前胎寬": "Front tire width", "後胎寬": "Rear tire width", "彎道半徑": "Corner radius",
    "前簧下重心高": "Front unsprung CG height", "後簧下重心高": "Rear unsprung CG height",
    "安裝預壓行程": "Installed preload travel", "靜態後壓縮限位行程": "Compression stop travel after static trim",
    "伸長限位行程": "Rebound stop travel", "壓縮限位剛性": "Compression stop rate", "伸長限位剛性": "Rebound stop rate",
    "彈簧／主簧剛性": "Spring rate", "主簧剛性": "Main spring rate", "Tender 剛性": "Tender spring rate",
    "Tender 靜態後併圈行程": "Tender bind travel after static trim", "Tender 自身併圈行程": "Tender bind travel",
    "彈簧曲線": "Spring curve", "運動比曲線": "Motion ratio curve", "臨界阻尼": "Critical damping",
    "壓縮阻尼": "Compression damping", "回彈阻尼": "Rebound damping",
}

MESSAGES = {
    "已匯入全車線性元件與車輛參數。工況使用新工具預設值。": "Imported linear vehicle parameters and components. The run uses default inputs.",
    "來源標記使用 Tender，但缺少完整併圈行程與安裝條件。請在元件頁輸入實際值，匯入目前保留來源的線性升沉剛性。": "The source indicates a tender spring. Its available linear heave rate was retained. Enter the tender bind travel and installation settings to use the tender spring.",
    "無法找到所有作用輪接地的穩定靜態平衡。請檢查承重彈簧、預壓、運動比及工況首筆資料。": "Could not find a stable static equilibrium with all active wheels in contact. Check spring rates, preload, motion ratios, and the initial input sample.",
    "LapData 首筆與零輸入工況皆無法建立靜態平衡。": "Static equilibrium failed with both the first recorded sample and zero inputs. ",
    "動畫模式最多輸出 30,001 筆。請使用「純計算並匯出 CSV」，或增加輸出間隔。": "Playback supports up to 30,001 samples. Use direct CSV export or increase the output interval.",
    "積分容許誤差必須大於零。": "Integration tolerance must be positive.",
    "積分無法達到誤差容許值。請檢查極端剛性、阻尼或路面資料。": "The solver could not meet its integration tolerance. Check rates, damping, and road data.",
    "模擬數值發散，請檢查元件曲線與輸入。": "The simulation diverged. Check component curves and run inputs.",
    "單輪模型未計入已停用的通道：": "The quarter-car model omits disabled channels: ",
    "觸及行程限位。": " reached a travel limit.",
    "車身姿態超過約 8.6°，小角度幾何誤差可能增大。": "Body angle exceeded about 8.6°. The small-angle approximation may be less accurate.",
    "姿態超過約 8.6°，小角度近似誤差可能增大": "Body angle exceeded about 8.6°. The small-angle approximation may be less accurate.",
    "模擬時間不足以完整通過所有選定輪位的凸塊。": "The run ended before every selected wheel crossed the bump.",
    "模擬結束前，部分選定輪位尚未進入 ISO 路面。": "Some selected wheels had not entered the ISO road at the end of the run.",
    "模擬結束時，加速度仍未升至設定值。": "The acceleration had not reached its target at the end of the run.",
    "零輪荷 ": "Zero wheel load: ",
    "各軸靜態質量須大於該軸簧下質量。": "Each axle's static mass must exceed its unsprung mass.",
    "總側傾剛性須大於零。請檢查 Roll 與直推通道設定。": "Total roll stiffness must be positive. Check the roll and direct-acting channels.",
    "21 個高度皆無法求解。": "None of the 21 heights could be solved.",
    "總質量必須大於四輪簧下質量總和。": "Total mass must exceed the combined unsprung mass.",
    "元件啟用欄位必須是布林值。": "The component enable field must be a boolean.",
    "依模型啟用的設定有誤。": "Invalid per-model channel enable settings.",
    "分析頁工況的格式有誤。": "Invalid analysis page scenario data.",
    "半車分析頁的模型設定有誤。": "Invalid half-car page model settings.",
    "量測 CSV 需要 2–100,001 筆資料。": "Recorded CSV must contain 2 to 100,001 samples.",
    "量測 CSV 的時間範圍須小於或等於 120 s。": "Recorded CSV must span no more than 120 s.",
    "CSV 缺少時間欄位 time_s（秒）。時間軸無法以 0 補齊。": "Missing required time_s column (seconds).",
    "CSV 有重複的欄名，請確認每個欄名只出現一次。": "Use unique CSV column names.",
    "CSV 缺少欄位 ": "Missing CSV columns: ",
    "量測 CSV 超過 100,001 筆資料。": "Recorded CSV exceeds 100,001 samples.",
    "CSV 欄名須依序為 ": "CSV columns must be in this order: ",
    "空力開關設定有誤。": "The aerodynamic enable field must be a boolean.",
    "載重轉移設定格式有誤。": "Invalid load transfer settings.",
    "無法辨識調校專案的格式。": "Unrecognised Dynamics Lab project format.",
    "專案名稱不可空白。": "Enter a project name.", "專案備註格式有誤。": "Project notes must be a list of strings.",
    "無法辨識懸吊模型。": "Unrecognised suspension model.",
    "1/4 車輪位或 1/2 車的車軸／側別設定有誤。": "Invalid active quarter-car wheel or half-car axle or side.",
    "分析頁的模型設定有誤。": "Invalid analysis page model settings.",
    "工況、作用輪位或後軸延遲設定有誤。": "Check the run scenario, selected wheels, and rear delay.",
    "1/4 車請使用凸塊／凹坑、ISO 路面或路面 CSV 回放。": "Choose a bump, ISO road, or CSV replay for the quarter-car model.",
    "側向加速度工況適用於全車及 1/2 左右模型。": "Use a full-car or left/right half-car model for lateral acceleration.",
    "輪胎接地濾波開關設定有誤。": "The tire road filter option must be a boolean.",
    "ISO 路面側向加速度開關設定有誤。": "The ISO road lateral acceleration option must be a boolean.",
    "路面作用輪位不在選定模型的輪位中。": "Select a road input wheel present in the active model.",
    "ISO 路面及凸塊後輪延遲需要至少 0.1 m/s 的車速。": "ISO road and delayed rear bump inputs require at least 0.1 m/s vehicle speed.",
    "ISO 路面隨機種子須為整數。": "The ISO road seed must be an integer.",
    "輸入開始時間須早於模擬結束時間。": "The input start must precede the end of the simulation.",
    "量測檔名格式有誤。": "Invalid CSV replay filename.",
    "車架傳力設定格式有誤。": "Invalid chassis force path settings.",
    "找不到可匯入的全車參數。": "The file does not contain importable full-vehicle parameters.",
    "專案須為 JSON 物件。": "The project must be a JSON object.",
    "專案欄位不完整或格式有誤：": "A project field is missing or invalid: ",
    "幾何查表設定格式有誤。": "Invalid geometry lookup table settings.",
    "幾何模式設定格式有誤。": "Invalid geometry input mode.",
    "彈簧力表至少需要兩列，力值須隨壓縮行程非遞減。": "The spring force table needs at least two rows and nondecreasing force with compression.",
    "無法辨識阻尼曲線類型。": "Unrecognised damper curve type.", "無法辨識彈簧曲線類型。": "Unrecognised spring curve type.",
    "無法辨識限位剛性類型。": "Unrecognised travel stop rate type.",
    "使用阻尼比欄位必須是布林值。": "The damping ratio option must be a boolean.",
    "阻尼比需要一段式、兩段式或四段式阻尼及車輛參數。": "Damping ratio requires a single, split, or bilinear damper and vehicle details.",
    "一段式阻尼的壓縮與回彈須使用同一個係數。": "A single-rate damper must use the same compression and rebound coefficient.",
    "係數表須由速度 0 起算，力表至少兩列且從 (0, 0) 起算。": " must begin at speed 0. A force table needs at least two rows and must start at (0, 0).",
    "必須嚴格遞增。": "must increase strictly.", "第一欄": " first column", "第二欄": " second column",
    "列需要兩個數值。": " must contain two numbers.", "列時間須遞增至少 0.00001 s。": " time must increase by at least 0.00001 s.",
    "列需要七欄。": " must contain seven columns.", "列的欄數與表頭不同。": " has a different number of columns than the header.",
    "列格式有誤。": " is incorrectly formatted.", "列須填入數值。": " must contain numeric values.", "須填入數值。": " must be numeric.",
    "欄名可省略，若有欄名請使用 ": " Use these names if a header is present: ", "筆資料。": " samples.",
    "需要": " requires ", "曲線 CSV 最多可匯入": "A curve CSV can contain at most", "幾何查表最多": "A geometry lookup table can contain at most",
    " 必須是有效數值": " must be a valid number", "（最小 ": " (minimum ", "，最大 ": ", maximum ",
    "列時間": " time", "第 ": " row ", "量測 CSV ": "Recorded CSV ", "兩個": "two ", "個數值。": " numeric values.",
    "列須有": " must contain", "筆欄位數有誤。": " has an invalid number of columns.", " 筆資料。": " samples.",
    "、": ", ", "。": ".", "：": ": ", "（": " (", "）": ")",
}

TRANSLATIONS = MESSAGES | LABELS | FIELD_LABELS
TEXT_PATTERN = re.compile("|".join(map(re.escape, sorted(TRANSLATIONS, key=len, reverse=True))))
CJK = re.compile(r"[\u3400-\u9fff]")
TEMPLATES = (
    (r"LapData 首筆無法求得靜態平衡。前 (\S+) 秒以零輸入模擬，之後接續原始資料。",
     r"The first recording sample had no static equilibrium. The run starts with \1 s of zero input, then resumes the original recording."),
    (r"出現零輪荷，約 (\S+) s（依輸出取樣估算）。", r" reached zero wheel load for about \1 s, estimated from output samples."),
    (r"以目前車速取樣 ISO 路面時，輸出間隔須小於 (\S+) s。", r"The output interval must be below \1 s for the selected ISO road and speed."),
    (r"ISO 路面需要超過 (\S+) 個積分步，請縮短模擬時間或降低車速。", r"ISO road requires over \1 integration steps. Shorten the run or reduce the speed."),
    (r"請先在「幾何查表」匯入 (\S+(?: \S+)*) CSV。", r"Import a \1 geometry CSV before using lookup mode."),
    (r"需要 (\d+) 段係數。", r" requires \1 coefficients."),
)


def english(value):
    for pattern, replacement in TEMPLATES:
        value = re.sub(pattern, replacement, value)
    return TEXT_PATTERN.sub(lambda match: TRANSLATIONS[match.group()], value)


def english_error(error):
    if isinstance(error, KeyError):
        return f"Missing required setting {error}."
    message = english(str(error))
    if CJK.search(message):
        translated = CJK.sub("", message).strip(" .:,")
        return f"Check the suspension settings or file format. {translated}".rstrip()
    return message or "The solver could not complete this operation."


def translated_notes(notes):
    return [english(note) if note in MESSAGES else note for note in notes]


def serialize_result(result):
    metrics = result.metrics.copy()
    if "load_transfer_rate" in metrics:
        metrics["load_transfer_rate"] = {english(label): data for label, data in metrics["load_transfer_rate"].items()}
    notes = result.project["notes"]
    warnings = translated_notes(notes) + [english(warning) for warning in result.warnings[len(notes):]]
    return {
        "time": result.time, "series": {english(name): series for name, series in result.signals.items()},
        "groups": {english(group): [english(name) for name in names] for group, names in result.groups.items()},
        "metrics": metrics, "warnings": warnings,
        "steps": result.steps, "corners": result.corners, "motion": result.motion,
        "tender_switches": {key: asdict(switches) for key, switches in result.tender_switches.items()},
        "wheel_travel_limits": result.wheel_travel_limits, "travel_thresholds": travel_thresholds(result),
        "replay_start": result.replay_start,
        "signature": result.signature, "project": result.project,
        "monitor": monitor_groups(result),
    }


def monitor_groups(result):
    def rows(labels):
        return [{"label": english(label), "signal": english(signal) if signal in result.signals else None}
                for label, signal in labels]

    modal = [(label, f"{label} 模態／輪端反力 [N]") for label in CHANNELS.values()]
    motion = result.groups["車身"]
    groups = [{"title": "Normal wheel loads (N)", "rows": rows([(c, f"{c} [N]") for c in result.corners])}]
    if len(result.corners) == len(CORNERS):
        groups.extend([
            {"title": "Wheel suspension forces (N)", "rows": rows([(c, f"{c} 輪端懸吊力 [N]") for c in result.corners])},
            {"title": "Modal channel forces (N)", "rows": rows(modal[:-len(CORNERS)])},
            {"title": "Direct wheel forces (N)", "rows": rows(modal[-len(CORNERS):])},
        ])
    else:
        groups.append({"title": "Modal and direct forces (N)",
                       "rows": rows([(label, signal) for label, signal in modal if signal in result.signals])})
        motion = [name for name in motion if name.endswith(("[deg]", "[mm]", "[m/s²]"))]
    groups.append({"title": "Body motion", "rows": rows([(name, name) for name in motion])})
    return groups


def travel_thresholds(result):
    vehicle, _, _ = prepare_simulation(result.project, lambda: False, lambda _: None)
    thresholds = []
    for index, component in vehicle.active:
        channel = tuple(CHANNELS)[index]
        limits = []
        if component.spring_kind == "tender":
            limits.append(("Tender bind", component.tender_bind_stroke))
        if component.jounce_rate:
            limits.append(("Compression stop", component.jounce))
        if component.rebound_rate:
            limits.append(("Rebound stop", -component.rebound))
        for kind, shaft_mm in limits:
            thresholds.append({
                "channel": channel, "label": english(CHANNELS[channel]), "kind": kind,
                "shaft_mm": shaft_mm,
                "modal_mm": wheel_travel_threshold(component.motion_ratio, 1., shaft_mm),
                "corners": vehicle.corners, "weights": vehicle.modal[index].tolist(),
            })
    return thresholds


def open_json(source):
    if isinstance(source, dict):
        source = deepcopy(source)
        distribution = source.get("load_transfer", {})
        distribution = distribution.get("distribution", {}) if isinstance(distribution, dict) else {}
        if isinstance(distribution, dict):
            distribution.pop("tire_tir", None)
    with TemporaryDirectory() as temporary:
        path = Path(temporary, "project.json")
        path.write_text(json.dumps(source, allow_nan=False), encoding="utf-8")
        project, _ = open_project(path)
    if project["name"] == "全車懸吊調校":
        project["name"] = english(project["name"])
    project["notes"] = translated_notes(project["notes"])
    return project


def parse_csv(kind, text):
    with TemporaryDirectory() as temporary:
        path = Path(temporary, "import.csv")
        path.write_bytes(text.encode("utf-8"))
        if kind == "road":
            missing = []

            def capture_missing(fields):
                missing.extend(fields)
                return True

            return {"rows": read_recording(path, confirm_missing=capture_missing), "missing": missing}
        if kind in ("roll_center", "anti"):
            return {"rows": read_geometry_csv(path, kind)}
        if kind in ("spring", "damper", "dampers", "mr"):
            return {"curves": read_force_csv(path, "dampers" if kind == "damper" else kind)}
        raise ValueError(f"Unknown CSV format {kind!r}.")


def simulate_csv(project, progress, notice):
    with TemporaryDirectory() as temporary:
        path = Path(temporary, "simulation.csv")
        count, warnings = export_simulation(project, path, progress=progress, notice=notice)
        with path.open(encoding="utf-8", newline="") as stream:
            csv = english(stream.readline()) + stream.read()
    return {"csv": csv, "count": count, "warnings": [english(warning) for warning in warnings]}


def load_transfer(project, payload):
    options = load_transfer_options(project.get("load_transfer", {}))
    options = transfer_options(options | payload.get("options", {}))
    if MODEL_PAGE[project["model"]] != "full":
        full = analysis_page_cases(project).get("full", {"model": "flex", "case": default_project()["case"]})
        project = project | full
    solver = TransferDistribution(project, options)
    result = solver.load_state(payload.get("ay_g", options["ay"]))
    bound = max(min(2.5, float(min(solver.lift_limits_g))), abs(options["ay"]), .05)
    accelerations = np.unique(np.r_[np.linspace(-bound, bound, 81), options["ay"]])
    return result | {
        "roll_gradient": solver.roll_gradient, "roll_stiffness": solver.roll_stiffness,
        "total_roll_stiffness": solver.total_roll_stiffness, "stiffness_share": solver.stiffness_share,
        "static": solver.static, "rc": solver.rc,
        "lift_limits_g": [float(limit) if np.isfinite(limit) else None for limit in solver.lift_limits_g],
        "sweep": {"ay_g": accelerations, "states": [solver.load_state(float(ay)) for ay in accelerations]},
    }


def chart(title, xlabel, ylabel, x, y):
    return {"title": title, "xlabel": xlabel, "ylabel": ylabel, "series": [{"x": x, "y": y}]}


def component_curves(project, channel):
    settings = project["channels"][channel]
    components = compile_project(project)
    index = tuple(CHANNELS).index(channel)
    component = components[index]
    notes = []
    component.set_static_reference(0.)
    try:
        vehicle, road = prepare_vehicle(project)
        if any(active == index for active, _ in vehicle.active):
            vehicle.equilibrium(road.at(0.), include_aero=False, road=road)
            component = next(kc for active, kc in vehicle.active if active == index)
            notes.append(f"No-aero static shaft position {component.static_stroke:.3g} mm.")
        else:
            notes.append("The active model does not use this channel. The preview uses zero static travel.")
    except ValueError:
        notes.append("Static equilibrium is unavailable. The preview uses zero static travel.")
    if settings.get("damper_ratio"):
        notes.append(f"Critical damping {component.critical_damping:.4g} N·s/m at damping ratio 1.0.")

    reference = component.static_stroke
    low = reference + 1.1 * min(0., -component.rebound - reference)
    high = reference + 1.1 * component.jounce_travel
    if low == high:
        low, high = reference - 1., reference + 1.
    limits = (*component.spring_breakpoints(), -component.rebound, reference, component.jounce)
    stroke = sorted({low, high, *(x for x in limits if low < x < high)})
    spring = [component.spring_force(x) + component.stop_force(x) for x in stroke]
    speed_knots = [x for x, _ in settings["compression"]] + [-x for x, _ in settings["rebound"]]
    speed_extent = max(.4, *map(abs, speed_knots))
    speed = sorted({-speed_extent, speed_extent, *speed_knots})
    ratio = component.motion_ratio
    mr_extent = max(50., *map(abs, ratio.x))
    travel = sorted({-mr_extent, mr_extent, *ratio.x})
    return {
        "spring": chart("Spring and travel stops", "Travel from no-aero static trim (mm)", "Force (N)", [x - reference for x in stroke], spring),
        "damper": chart("Damper curve", "Shaft speed (m/s)", "Damping force (N)", speed, [component.damper_force(x) for x in speed]),
        "mr": chart("Motion ratio", "Wheel or modal travel (mm)", "MR", travel, [ratio.lookup(x) for x in travel]),
        "notes": notes,
    }


def dispatch(command, payload, report):
    if command == "defaults":
        return default_project() | {"name": "Full Vehicle Setup"}
    if command == "importProject":
        return open_json(payload["project"])
    if command == "parseCsv":
        return parse_csv(payload["kind"], payload["text"])

    def progress(value):
        report(float(value), "")

    def notice(value):
        report(-1., english(value))

    project = payload["project"]
    if command == "simulate":
        return serialize_result(simulate(project, progress=progress, notice=notice))
    if command == "simulateCsv":
        return simulate_csv(project, progress, notice)
    if command == "rollCenterScan":
        if project["model"] != "half_lr":
            raise ValueError("Select the left/right half-car model before running a roll center scan.")
        scan = scan_roll_center(project, lambda: False, progress)
        return {
            "axle": scan.axle, "center_mm": scan.center_mm, "lookup": scan.lookup, "heights": scan.heights,
            "peaks": scan.peaks, "best_index": scan.best_index, "best_result": serialize_result(scan.best_result),
            "failures": [english(failure) for failure in scan.failures],
        }
    if command == "loadTransfer":
        return load_transfer(project, payload)
    if command == "componentCurves":
        return component_curves(project, payload["channel"])
    if command == "dampingScale":
        channel = payload["channel"]
        mass = damping_reference_mass(channel, project["vehicle"], sum(project["tires"][corner]["mu"] for corner in CORNERS))
        return KCSystem(project["channels"][channel], damping_mass=mass).critical_damping
    raise ValueError(f"Unknown dynamics command {command!r}.")


def json_value(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    raise TypeError(f"Unsupported solver value {type(value).__name__}.")


def handle(command, payload_json, report):
    try:
        result = dispatch(command, json.loads(payload_json), report)
        return json.dumps({"ok": True, "result": result}, default=json_value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except (ArithmeticError, TypeError, ValueError, KeyError, AttributeError) as error:
        return json.dumps({"ok": False, "error": english_error(error)}, ensure_ascii=False)
