# References

Every number in `src/presets.js` and every target in `tools/validate.js` traces
to something here. If you change a constant, change its entry.

## Thermal thresholds for reproductive females and pups

**22–40 °C, the band the model scores against.** Fontaine, A., Lemieux-Labonté,
V., Lapointe, F.-J., et al. (2021). Using mounting, orientation, and design to
improve bat box thermodynamics in a northern temperate environment. *Scientific
Reports* 11:7728. They call it the Extended Optimal Temperature Range for
reproductive female little brown bats. Below 22 °C a gestating or lactating
female spends 50–70% of her time in torpor, which stalls fetal and pup
development; above 40 °C bats abandon their preferred roost position to
thermoregulate.

**45 °C and 50 °C, the acute and lethal marks.** de Mel, R. K., Baloun, D. E.,
Freeman, M. T., & Czenze, Z. J. (2025). Using physiology to unravel the
implications of heatwaves for big brown bats (*Eptesicus fuscus*). *Journal of
Experimental Biology* 228:jeb251228. Roosts in full sun exceeded 50 °C; at those
temperatures the evaporative water needed to survive a day exceeds the lethal
dehydration threshold of 22.1% of body mass.

## Measurements the model is tested against

**Fontaine et al. 2021**, above. Quebec, mid-May to mid-September 2017, 122 days,
seven sites. Black four-chamber "Classic" boxes, no vents, mounted 3–4 m up.
Reported: pooled range 6.5–44 °C on poles and 6.5–48.5 °C on unheated buildings;
Classic boxes inside 22–40 °C for 46% of the window; east-facing boxes
significantly warmer in the morning on buildings; orientation making almost no
difference on poles.

Validation sites are stand-ins for the named study locations, which have no
published coordinates: Morgan Arboretum (45.431, −73.943) for a warm site,
Montmorency Forest (47.323, −71.152, 750 m) for a cold one.

**de Mel et al. 2025**, above. Artificial roosts near Lillooet, British Columbia.
An east-facing roost read 38.5 °C on an ordinary day and peaked at 55.5 °C during
the June 2021 heat dome; a west-facing roost read 32 °C. The tool validates
against the heat-dome peak; the ordinary-day figures are not used, because the
secondary sources I could reach do not pin down which roost type each belongs to.

## Design and placement criteria

Merlin Tuttle's Bat Conservation, *Selecting a Quality Bat House*
(<https://www.merlintuttle.org/selecting-a-quality-bat-house/>). Roosting
crevices ¾ inch wide for most temperate species, wider for big brown, pallid and
Florida bonneted bats; boxes at least 20 inches tall; exterior wood at least
¾ inch thick; interior surfaces grooved 1/16 inch deep at ¼–¾ inch intervals;
landing area extending at least 4 inches below the partitions; mounted at least
20 feet from the nearest tree limbs.

**The colour table**, implemented in `presets.js` as `tableRecommendation()`:
black where average July highs are below 85 °F, dark brown or dark grey at
85–95 °F, medium at 95–100 °F, white or light above 100 °F.

**Occupancy by mount type.** Pole-mounted houses show the highest occupancy in
field studies and are found roughly two and a half times faster than tree-mounted
ones; tree mounts are the least successful, from shade, predator access and
branches in the flight path. Reported by MTBC and Bat Conservation International
from the North American Bat House Research Project. The model does not use these
figures; the interface prints them, because thermal performance is not the only
thing that decides whether bats move in.

## Physical constants

**Solar absorptivity of painted exterior wood.** ASHRAE *Handbook —
Fundamentals*, surface-property tables: black 0.95, dark brown or dark grey 0.85,
medium 0.70, light tan or light grey 0.45, white 0.25.

**Wood properties.** Pine k = 0.12 W/m·K, ρ = 500 kg/m³, c = 1700 J/kg·K;
plywood, cedar and recycled plastic lumber in `presets.js`. Long-wave emissivity
of weathered wood taken as 0.90.

**Exterior film coefficient.** McAdams smooth-surface fit, h = 5.7 + 3.8·v,
combined cubically with natural convection off a vertical plate, h = 1.31·ΔT^⅓.

**Sky temperature.** Berdahl & Martin clear-sky emissivity from the dew point,
blended toward air temperature with cloud fraction.

**Solar position.** NOAA solar calculator equations, from Meeus, *Astronomical
Algorithms*, low-precision set. Accurate to about 0.01°.

**Irradiance on a tilted plane.** Isotropic sky, Liu & Jordan (1960). Ground
reflectance 0.20.

**Bat metabolic heat.** 0.07 W per resting animal, from normothermic resting
metabolic rate for an 8 g vespertilionid converted at 20.1 J per mL O₂.

## Weather data

Open-Meteo historical weather API, ERA5 and ERA5-Land reanalysis
(<https://open-meteo.com/en/docs/historical-weather-api>). Free for
non-commercial use, no key, CORS open, hourly from 1940, with elevation
downscaling and local UTC offset returned per request. Geocoding from the same
project.

ERA5 is a roughly 9 km grid. It cannot see the tree at the edge of your yard, and
on the calmest afternoons it reports 10 m wind below any real anemometer, which
is why the model holds a light-air floor of 0.5 m/s at the box.
