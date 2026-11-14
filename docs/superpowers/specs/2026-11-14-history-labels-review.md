# History labels review / 历史标签审核

Please check each row before the backtest runs: is the outcome right, is each cause in the right category, and is `site_related` right? Only site-related causes count against a landing site in the backtest. Edit `src/lunarnav/catalog/missions.yaml` or note corrections here.

请在回测之前逐行核对：结果对不对、每个原因的类别对不对、`site_related`（是否与着陆点有关）对不对。回测时只有与着陆点有关的原因才算作着陆点的问题。可以直接改 `src/lunarnav/catalog/missions.yaml`，也可以把修改意见写在这里。

| Mission | Outcome | Cause category | Site-related | Counts against criterion | Cause summary | Source |
|---|---|---|---|---|---|---|
| IM-1 Odysseus | partial | sensor | no | — | The laser rangefinder safety switch was not enabled before launch, so the altitude lasers did not work in descent; the team switched to NASA's NDL lidar. | [link](https://en.wikipedia.org/wiki/IM-1) |
| IM-1 Odysseus | partial | slope_tipover | **yes** | slope_tipover | Without laser altimetry it landed faster than planned on a slope of about 12 degrees, beyond its design limit, broke a leg and tipped onto its side. | [link](https://en.wikipedia.org/wiki/IM-1) |
| IM-2 Athena | failed_landing | sensor | no | — | The altimeter failed during landing and a dust plume obscured the laser rangefinder, so the computer had no accurate altitude. | [link](https://en.wikipedia.org/wiki/IM-2) |
| IM-2 Athena | failed_landing | slope_tipover | **yes** | slope_tipover | It struck a plateau, skidded, rolled and came to rest on its side inside a crater. | [link](https://en.wikipedia.org/wiki/IM-2) |
| IM-2 Athena | failed_landing | illumination_power | **yes** | illumination_power | Lying sideways in a crater near the south pole, power generation was low; operations ended under 13 hours after landing. | [link](https://en.wikipedia.org/wiki/IM-2) |
| HAKUTO-R Mission 1 | failed_landing | gnc_software | no | — | The onboard computer judged the radar altimeter faulty and ignored it, hovered about 5 km up until propellant ran out, then fell. | [link](https://en.wikipedia.org/wiki/Hakuto-R_Mission_1) |
| HAKUTO-R Mission 1 | failed_landing | terrain_navigation | **yes** | terrain_navigation | LABEL TO VERIFY: ispace attributed the altimeter rejection to the sudden altitude change when crossing the rim of Atlas crater; this is not on the Wikipedia page read. | [link](https://en.wikipedia.org/wiki/Hakuto-R_Mission_1) |
| HAKUTO-R Mission 2 (Resilience) | failed_landing | sensor | no | — | ispace's analysis identified a laser range finder anomaly as the cause of the hard landing; contact was lost about 90 s before the projected landing. | [link](https://en.wikipedia.org/wiki/Hakuto-R_Mission_2) |
| Beresheet | failed_landing | sensor | no | — | An IMU gyroscope failed during braking. | [link](https://en.wikipedia.org/wiki/Beresheet) |
| Beresheet | failed_landing | gnc_software | no | — | Restarting the second IMU triggered a reboot that shut the main engine down; it struck the surface at about 140 m/s. | [link](https://en.wikipedia.org/wiki/Beresheet) |
| Chandrayaan-2 Vikram | failed_landing | gnc_software | no | — | The failure analysis committee concluded a software glitch; the lander deviated from its trajectory below 2.1 km and crash-landed. | [link](https://en.wikipedia.org/wiki/Chandrayaan-2) |
| Chandrayaan-3 Vikram | success | — | — | — | (control: no causes) | [link](https://en.wikipedia.org/wiki/Chandrayaan-3) |
| SLIM | partial | propulsion | no | — | An engine nozzle was lost during descent; the lander came down on its side or nose with its solar panels facing away from the Sun. | [link](https://en.wikipedia.org/wiki/Smart_Lander_for_Investigating_Moon) |
| Luna 25 | failed_before_landing | propulsion | no | — | A maneuvering engine failed to shut down and burned 127 s instead of 84 s, putting the craft into the Moon before any landing attempt. | [link](https://en.wikipedia.org/wiki/Luna_25) |
| Peregrine Mission One | failed_before_landing | propulsion | no | — | A propellant leak developed soon after separation from Vulcan; no landing was possible and the spacecraft burned up on reentry. | [link](https://en.wikipedia.org/wiki/Peregrine_Mission_One) |
| Blue Ghost Mission 1 | success | — | — | — | (control: no causes) | [link](https://en.wikipedia.org/wiki/Blue_Ghost_Mission_1) |
| Chang'e 4 | success | — | — | — | (control: no causes) | [link](https://en.wikipedia.org/wiki/Chang%27e_4) |
| Chang'e 5 | success | — | — | — | (control: no causes) | [link](https://en.wikipedia.org/wiki/Chang%27e_5) |
| Chang'e 6 | success | — | — | — | (control: no causes) | [link](https://en.wikipedia.org/wiki/Chang%27e_6) |

**Rows that need a decision / 需要你决定的行：**

- **HAKUTO-R M1, terrain_navigation**: the crater-rim explanation comes from ispace's analysis, not from the Wikipedia page we read. Keep it as site-related, or drop it? / 陨坑边缘这个原因来自 ispace 的分析，不在我们读过的维基页面上。保留为与着陆点有关，还是删掉？
- **IM-1 and SLIM outcome = partial**: both landed but on their side. Keep `partial`, or call them `failed_landing`? / 两者都着陆了但侧倒。保持 `partial`，还是改为 `failed_landing`？
- **SLIM**: only the lost engine nozzle is listed (not site-related). The page gives no slope cause, so the backtest expects SLIM's site to look *clear*. / 只列了发动机喷管脱落（与着陆点无关）。页面没有提到坡度原因，所以回测预期 SLIM 的着陆点评估为*没有问题*。
