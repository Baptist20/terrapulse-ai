/**
 * User-triggered prompt input presets for the Quick Demo chip on /dashboard.
 * Contains ONLY raw observation prompts (no mock AI outputs or fake triage data).
 */
export const QUICK_SCENARIO_CHIPS = {
  agri: [
    {
      label: "Cassava leaf curl + whiteflies",
      location: "Cassava Plot 4 [Zone B]",
      text: "Cassava leaves in Plot 4 curling yellow with whiteflies underneath and mosaic mottling spreading across rows.",
      image: "/images/agri-field-blight.jpg",
    },
    {
      label: "Maize whorl armyworm frass",
      location: "Maize Ridge 2",
      text: "Fresh pinhole damage and sawdust-like frass inside young maize leaf funnels across eastern edge.",
      image: null,
    },
    {
      label: "Drip-line salinity crust",
      location: "Tomato Block C",
      text: "White crystalline salt crust forming along drip emitter lines; lower tomato leaves curling inward.",
      image: null,
    },
  ],
  construction: [
    {
      label: "Retaining wall 6mm shear crack",
      location: "North Retaining Wall [7B]",
      text: "Diagonal 6mm concrete crack propagating near wall mid-height with continuous damp seepage along the joint.",
      image: "/images/site-ops-crack.jpg",
    },
    {
      label: "Unshored trench lip slumping",
      location: "Utility Trench Sector 4",
      text: "Tension cracks appearing 1.2m back from unshored clay trench lip after overnight storm; slight inward slumping.",
      image: null,
    },
    {
      label: "Pier cap rebar cover spalling",
      location: "Bridge Pier Cap 3",
      text: "Hollow sounding concrete slab edge with rust staining bleeding through hairline flexural fissures.",
      image: null,
    },
  ],
};
