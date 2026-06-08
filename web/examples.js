// Example POV-Ray SDL scenes shared by the UI page and the REPL.
// Pure data module, no DOM. Each scene has been render-verified against the
// dist/ wasm build (notably: this build's glass.inc has no M_Glass* materials,
// so the glass example uses texture { T_Glass3 } + interior { I_Glass }).

export const EXAMPLES = [
  {
    name: 'checker-sphere',
    title: 'Checkered floor & alabaster sphere',
    source: `#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "colors.inc"
#include "textures.inc"
camera { location <0, 1.5, -4> look_at <0, 0.5, 0> }
light_source { <3, 5, -3> color White }
background { color SkyBlue }
plane { y, 0 pigment { checker color White color Blue scale 0.5 } }
sphere { <0, 1, 0>, 1 texture { PinkAlabaster } finish { reflection 0.2 } }
`,
  },
  {
    name: 'glass',
    title: 'Glass sphere (glass.inc)',
    source: `#version 3.8;
global_settings { assumed_gamma 1.0 max_trace_level 8 }
#include "colors.inc"
#include "glass.inc"
camera { location <0, 1.2, -3.5> look_at <0, 0.7, 0> }
light_source { <4, 6, -4> color White }
background { color rgb <0.05, 0.05, 0.08> }
plane { y, 0 pigment { checker color rgb 0.9 color rgb 0.2 } }
sphere { <0, 0.8, 0>, 0.8 texture { T_Glass3 } interior { I_Glass } }
`,
  },
  {
    name: 'wood-csg',
    title: 'Wood CSG (woods.inc)',
    source: `#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "colors.inc"
#include "woods.inc"
camera { location <2.5, 2, -3> look_at <0, 0.4, 0> }
light_source { <3, 6, -4> color White }
background { color rgb <0.2, 0.25, 0.3> }
plane { y, 0 pigment { color rgb 0.85 } }
difference {
  box { <-1, 0, -1>, <1, 0.8, 1> }
  sphere { <0, 0.8, 0>, 0.6 }
  texture { T_Wood10 scale 0.5 }
}
`,
  },
  {
    name: 'chrome-sky',
    title: 'Chrome & clouds (skies.inc, metals.inc)',
    source: `#version 3.8;
global_settings { assumed_gamma 1.0 }
#include "colors.inc"
#include "skies.inc"
#include "metals.inc"
camera { location <0, 1, -4> look_at <0, 1, 0> angle 60 }
light_source { <10, 20, -10> color White }
sky_sphere { S_Cloud2 }
plane { y, 0 pigment { color rgb <0.3, 0.45, 0.3> } }
sphere { <0, 1, 0>, 1 texture { T_Chrome_2D } }
`,
  },
];

export function getExample(name) {
  return EXAMPLES.find((e) => e.name === name)?.source;
}
