# Roostcast

Simulates the temperature inside a bat house, hour by hour, chamber by chamber,
through a real maternity season at your coordinates. Tells you whether the box
you are about to hang will cook the colony that moves into it.

Open `dist/roostcast.html` in a browser. Nothing to install; no account; works
from a USB stick.

## Why this exists

Bat house guidance decides paint colour from one number, the average July daily
high:

| Average July high | Paint it |
|---|---|
| under 85 °F | black |
| 85–95 °F | dark brown or dark grey |
| 95–100 °F | medium |
| over 100 °F | white or light |

That rule is careful work and it is the best thing anyone had for thirty years.
It is also an average, and bats do not die on averages.

Portland, Oregon has an average July high of 82 °F, which puts it in the coldest
bucket: paint it black. In June 2021 the heat dome sat on Portland for four days.
Run a black four-chamber box through that season and the model gives a peak of
47 °C and fourteen hours where no chamber in the box is under 40 °C. A roosting
bat cannot leave in daylight. Painted white, the same box at the same site peaks
at 45.8 °C and spends five fewer hours past 45 °C.

Lillooet, British Columbia is worse. Average July high 85 °F, so again the table
says black. Black gives 17 hours with no cool chamber anywhere; white gives 8,
and cuts time past 45 °C by fourteen hours. Lillooet is where de Mel and
colleagues measured a real east-facing roost hitting 55.5 °C for six hours in
that same heat dome, and calculated that the bats inside would have needed to
evaporate more than 22% of their body mass to survive it.

The table cannot see any of this. It knows one number about a place. It does not
know your latitude, which way the box points, whether its back is against a wall,
or that the sun striking a south-facing wall in late August comes in at an angle
it never reaches in June.

So: stop looking the answer up, and simulate it.

## What it does

Enter a location. It pulls hourly ERA5 reanalysis for that spot, picks the
hottest of the last ten maternity seasons if you want the honest worst case, and
runs a transient thermal model of the box you describe: how many chambers, what
colour, mounted on what, facing which way, in how much sun.

Out the other end:

**Refuge hours.** The share of daylight hours where at least one chamber sits in
22–40 °C. This is the floor. Below it, some part of the colony is in trouble.

**No-refuge hours.** Hours where every chamber is over 40 °C at once. This is the
number that matters most and the one no existing guidance produces. A box with
one scorching chamber and one cool one is a working box; a colony spreads out and
moves. A box where the whole thing is past 40 °C is a trap, because bats roost by
day and cannot fly out of it.

**Usable share.** What fraction of all chamber-hours are inside the band. Refuge
hours saturate near 100% on any multi-chamber box, so they cannot rank options;
this can.

Then it sweeps every combination of colour, orientation and mount against the
same season and ranks them, and tells you where the colour table and the
simulation disagree about your site.

## What I got wrong on the way

Worth saying, because the errors were large and the shape of them is instructive.

The first version put the wood's thermal resistance between the sunlit surface
and the outside air. Sun is absorbed *at* that surface and convection happens at
that same surface; there is no wood in between. Cost: about 19 °C.

The second put the solar azimuth 180° out, so at local noon the model had the sun
due north. The consequence was quiet and nasty: a south-facing box was fed the
irradiance of a north wall, the north-facing back panel got the southern sun, and
the rear chamber came out hottest. Every gradient in the box ran backwards and
nothing crashed.

The third modelled ventilation as building-style air changes per hour. A roosting
crevice is 19 mm wide, open at the bottom, with hot wood on both faces: it is a
chimney, and it turns over its own volume more than once a second. Treating it as
infiltration was off by roughly eighty-fold and made every box about 12 °C too
hot.

The fourth reported chamber air temperature as if that were what a bat
experiences. It is not. A bat hangs pressed against wood with a buoyant draught
running past it, so the model now reports operative temperature, weighting the
wood and the air by their transfer coefficients. That is also much closer to what
a logger taped inside a crevice actually records.

None of the constants are fitted to the validation cases. They come from ASHRAE
surface-property tables and from published bat physiology. `tools/validate.js` is
a test, not a calibration.

## How well does it work

```
$ node tools/validate.js

published comparison                              want    model   err     ok
de Mel 2025 · east-facing roost, 2021 heat dome   55.5    53.9    -1.6    yes
Fontaine 2021 · share of season within 22-40 C    46.0    36.7    -9.3    yes
Fontaine 2021 · under pooled 7-site maximum       -5.0    -6.6    -1.6    yes

ordering the tool asserts
black peaks above white                           37.4 vs 31.6          yes
full sun peaks above full shade                   37.4 vs 31.6          yes
east wall-mount peaks earlier than west           11.3h vs 15.8h        yes
orientation barely matters on a free pole         37.7 vs 37.6          yes
tree mount runs cooler than open pole             33.8 vs 37.4          yes
front chamber hottest on a July afternoon         31.1 > 27.7 > 27.2    yes
south wall at 45 N peaks after midsummer          peak in month 9       yes
```

The heat-dome peak lands within 1.6 °C of a measured roost with no fitting, which
is better than I expected. The seasonal share is 9 points low, which I have not
resolved and am not going to paper over.

Two of the ordering results are worth pointing at, because the model produced
them before I knew to look for them. Fontaine reports that orientation makes
almost no difference to a pole-mounted box, and the model agrees, for a reason
that is obvious once you see it: a free-standing box has two exposed faces, so an
east-facing box is a west-facing box with its chambers in reverse order. Only a
wall at its back makes which way it points mean anything. And a south-facing
vertical wall at 45° N takes its hardest sun in September, not at the solstice,
because midsummer sun is too high to strike it squarely.

### What is and is not comparable

Fontaine et al. report a pooled range of 6.5–44 °C for Classic boxes across seven
Quebec sites. That lower bound proves the range is not a set of raw extremes:
ERA5 puts the regional air minimum at −2.5 °C inside their recording window, and
a 19 mm wooden box cannot sit nine degrees above air on a clear calm night. So
their maximum is a maximum over many boxes at many sites, and a single simulated
box should land under it. It does, by about 7 °C. Comparing those two numbers as
though they were the same quantity would be the easiest available way to make
this model look better than it is.

## Where it is weak

Absolute temperatures carry roughly ±5 °C of uncertainty. Most of that is local
shading and wind that a 9 km reanalysis grid cannot see; some of it is that I
have no datalogger data of my own to test against, only what other people
published in summary form.

The comparisons are much firmer than the absolute numbers, because a modelling
error moves every option in the same direction. Use it to choose between
configurations, then verify the one you install.

It also does not know about occupancy. The model will happily rank a wall mount
above a pole on thermal grounds, and Tuttle's field data says pole-mounted houses
are occupied far more often and about two and a half times faster, with
tree-mounted houses worst of all for reasons that have nothing to do with
temperature: shade, predator access, branches in the flight path. The interface
prints that alongside the thermal result. A thermally perfect box on a tree trunk
is still a bad bat house.

Unmodelled, and all in the direction of the model running cool: bats packed into
a crevice obstruct the draught that cools it; the air in a tall crevice
stratifies rather than mixing; and I assume the crevice bottoms are fully open
across the box width.

## Running it

```
node tools/validate.js         # test against published measurements
node tools/report.js           # colour table vs simulation, eight sites
node tools/report.js --hottest # same, worst season of the last ten
node tools/smoke.js            # drive the real page in headless Chrome
node tools/build.js            # inline everything into dist/roostcast.html
```

Weather is cached under `.cache/`, so everything after the first run is offline.

## Layout

```
index.html          the page
src/solar.js        sun position, irradiance on a tilted plane
src/thermal.js      the box: panels, chambers, chimney flow, scoring
src/presets.js      designs, colours, thresholds, the colour table
src/climate.js      ERA5 via Open-Meteo, cached in localStorage
src/ui.js           front end
tools/              validate, report, smoke, build
```

## Sources

Thresholds, constants and every published number this is tested against are in
[REFERENCES.md](REFERENCES.md).

## Licence

CC0. Public domain. Take it, fork it, put your own name on it, fold the model
into something better. If it helps one certification programme give
climate-aware advice instead of a lookup table, it has done its job.

Built for the people who have spent their lives arguing that bats are worth the
trouble.
