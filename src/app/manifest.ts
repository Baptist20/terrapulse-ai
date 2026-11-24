import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TerraPulse AI — Field Triage",
    short_name: "TerraPulse",
    description:
      "Offline-first hybrid AI agronomy and construction field triage",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#090d16",
    theme_color: "#10b981",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
