# What I got wrong on the way

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
