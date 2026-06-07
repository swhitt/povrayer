#version 3.8;
#include "colors.inc"
#include "textures.inc"
camera { location <0, 1.5, -4> look_at <0, 0.5, 0> }
light_source { <3, 5, -3> color White }
background { color SkyBlue }
plane { y, 0 pigment { checker color White color Blue scale 0.5 } }
sphere { <0, 1, 0>, 1 texture { PinkAlabaster } finish { reflection 0.2 } }
