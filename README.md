# Suspension-Dynamics

這個儲存庫用來建立與分析車輛懸吊動態，包含互相關聯但用途不同的桌面調校工具、瀏覽器版工作台，以及數套研究／驗證用的模擬模型。可用於設定彈簧、阻尼、輪胎與車輛參數，模擬路面輸入下的車身與輪端反應，並檢視輪荷、行程、姿態及載重轉移。

## 主要資料夾

| 資料夾 | 用途 |
| --- | --- |
| [`SuspensionDynamicsLab/`](SuspensionDynamicsLab/README.md) | 主要的桌面懸吊調校工具。支援全車、半車與 1/4 車模型、工況模擬、A/B 設定比較、曲線與 CSV 匯出。包含 Python/Tkinter 介面、求解器、測試、範例專案及 LP02 車身／車輪 STL；桌面版可用 PyVista 顯示實車 3D。 |
| [`docs/`](docs/README.md) | 發佈到 GitHub Pages 的瀏覽器版工作台。以 JavaScript 介面搭配 Pyodide 在瀏覽器執行模擬，提供車輛設定、全車／半車／1/4 車分析及示意動畫。 |
| [`dynamics_analyze/`](dynamics_analyze/README.md) | 模組化的懸吊動態分析程式與實驗入口，包含不同車輛模型、K&C 彈簧／阻尼元件、懸吊設定、路面輸入及分析案例。 |
| [`Suspension_sys/`](Suspension_sys/README.md) | 整合式全車懸吊模型與相關實驗資料，包含車輛狀態、懸吊與幾何力模型、路面輸入、結果視覺化及 STL 展示程式。 |
| [`tools/`](tools/) | 專案維護工具，例如同步桌面 Python 求解器至網頁 runtime 的腳本。 |

`SuspensionDynamicsLab`、`dynamics_analyze` 與 `Suspension_sys` 是不同階段、不同用途的模型與工具，不是單一程式的不同子模組；依需求選擇對應入口即可。

## 快速開始：桌面版

在 Windows 上可雙擊 [`Start-SuspensionDynamicsLab.bat`](SuspensionDynamicsLab/Start-SuspensionDynamicsLab.bat) 啟動。或在 PowerShell 執行：

```powershell
cd SuspensionDynamicsLab
python -m pip install -r requirements.txt
python -m setup_lab
```

桌面版需要 Python 3.10+、Tkinter 與 NumPy；LP02 實車 3D 顯示使用 PyVista。測試也請在 `SuspensionDynamicsLab` 目錄中執行：

```powershell
python -m unittest discover -s tests -v
```

## 瀏覽器版

在儲存庫根目錄執行下列指令，再開啟 `http://localhost:8765`：

```powershell
python -m http.server 8765 --directory docs
```

瀏覽器版的計算 runtime 位於 [`docs/runtime/`](docs/runtime/)，網頁介面程式位於 [`docs/js/`](docs/js/)。它的車輛動畫是網頁示意圖；桌面版 PyVista STL 檢視功能不包含在網頁版中。若修改桌面求解器的 Python 程式，需要同步網頁 runtime：

```powershell
python tools/sync_web_runtime.py
```

## 其他常用資料

- `SuspensionDynamicsLab/setup_lab/`：桌面版介面、模擬引擎、路面與車輛模型、分析及視覺化。
- `SuspensionDynamicsLab/examples/`、`SuspensionDynamicsLab/projects/`：範例工況、專案設定及模擬結果資料。
- `SuspensionDynamicsLab/tests/`：桌面版測試。
- `dynamics_analyze/model/`：懸吊動態與 K&C 元件模型。
- `dynamics_analyze/road/`、`dynamics_analyze/suspension_set/`：路面輸入與車輛／懸吊設定。
- `Suspension_sys/model/`、`Suspension_sys/data_visualization/`、`Suspension_sys/STL/`：整合模型、結果顯示與幾何模型資料。
- [`LICENSE`](LICENSE)：本儲存庫的授權資訊。
