"""Stream dynamic simulation samples to CSV without building a playback result."""

import csv
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np

from .engine import Cancelled, integrate_samples, output_times, prepare_simulation, tire_working_radius
from .project import CHANNELS


def export_simulation(project, path, cancel=lambda: False, progress=lambda fraction: None, *,
                      notice=lambda message: None):
    vehicle, road, equilibrium = prepare_simulation(project, cancel, notice)
    nb, n = vehicle.nb, vehicle.n
    wheel_slice = vehicle.wheels
    names = tuple(CHANNELS)
    angles = {}
    if vehicle.axes[0]:
        angles["俯仰"] = nb - 1
    if vehicle.flex:
        angles.update(前側傾=1, 後側傾=2)
    elif vehicle.axes[1]:
        angles["側傾"] = 1

    corner_signals = ("輪端位移 [mm]", "輪端垂直速度 [m/s]", "輪端垂直加速度 [m/s²]",
                      "簧上位移 [mm]", "簧上垂直速度 [m/s]", "簧上垂直加速度 [m/s²]",
                      "輪端行程 [mm]", "輪荷 [N]", "輪端懸吊力 [N]", "路面高度 [mm]", "路面速度 [m/s]",
                      "輪胎工作半徑 [mm]")
    channel_signals = ("模態／輪端反力 [N]", "軸心行程 [mm]", "軸心速度 [m/s]",
                       "彈簧力 [N]", "阻尼力 [N]", "限位塊力 [N]")
    header = ("time_s", "縱向加速度 [m/s²]", "側向加速度 [m/s²]", "車速 [m/s]", "模型承受下壓力 [N]",
              "升沉 [mm]", "升沉速度 [m/s]", "升沉加速度 [m/s²]",
              *(f"{name}{suffix}" for name in angles for suffix in (" [deg]", "角速度 [deg/s]", "角加速度 [deg/s²]")),
              *(f"{corner} {signal}" for corner in vehicle.corners for signal in corner_signals),
              *(f"{names[i]} {signal}" for i, _ in vehicle.active for signal in channel_signals))
    dt = road.options["dt"]
    count = 0
    lifted = np.zeros(vehicle.nw, dtype=bool)
    large_angle = False
    path = Path(path)
    temporary = None
    try:
        with NamedTemporaryFile(mode="w", encoding="utf-8-sig", newline="", dir=path.parent,
                                prefix=".simulation-", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            writer = csv.writer(stream)
            writer.writerow(header)
            times = output_times(road.duration, dt, replay_start=road.replay_start)
            for t, state, _ in integrate_samples(vehicle, road, equilibrium, times, cancel):
                if count % 128 == 0:
                    if cancel():
                        raise Cancelled()
                    progress(.99 * t / road.duration)
                inputs_active = t >= road.replay_start
                displacement, velocity = state[:n], state[n:]
                q = equilibrium + displacement
                height, road_velocity, ax, ay = vehicle.road_inputs(road, t, q, velocity)
                acceleration, loads, readings, suspension, _ = vehicle.forces(
                    q, velocity, (height, road_velocity, ax, ay), True, include_aero=inputs_active
                )
                lifted |= loads <= 1e-8
                if nb > 1 and np.max(np.abs(q[1:nb])) > .15:
                    large_angle = True

                attitude = (value for i in angles.values()
                            for value in np.rad2deg([displacement[i], velocity[i], acceleration[i]]))
                working_radii = tire_working_radius(vehicle.tire_radius, loads, vehicle.tire_k)
                corner_values = zip(
                    displacement[wheel_slice] * 1000, velocity[wheel_slice], acceleration[wheel_slice],
                    vehicle.B @ displacement[:nb] * 1000, vehicle.B @ velocity[:nb], vehicle.B @ acceleration[:nb],
                    vehicle.travel @ q * 1000, loads, suspension, height * 1000, road_velocity, working_radii * 1000,
                )
                channels = (value for i, _ in vehicle.active for value in readings[i])
                speed = road.options["speed"] if inputs_active else 0.
                aero_load = vehicle.aero_load if inputs_active else 0.
                writer.writerow((t, ax, ay, speed, aero_load,
                                 displacement[0] * 1000, velocity[0], acceleration[0], *attitude,
                                 *(value for corner in corner_values for value in corner), *channels))
                count += 1
        if cancel():
            raise Cancelled()
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    progress(1.)
    warnings = [road.replay_notice] if road.replay_notice else []
    if lifted.any():
        warnings.append("零輪荷 " + "、".join(corner for corner, lost in zip(vehicle.corners, lifted) if lost))
    if large_angle:
        warnings.append("姿態超過約 8.6°，小角度近似誤差可能增大")
    return count, warnings
