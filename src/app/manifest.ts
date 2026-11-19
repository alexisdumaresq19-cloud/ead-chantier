import type { MetadataRoute } from "next";

// Lets phones and tablets install the app on the home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EAD Chantier",
    short_name: "EAD",
    description: "Plans, documents, photos et rapports journaliers des chantiers.",
    lang: "fr-CA",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b0d10",
    theme_color: "#0b0d10",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/brand/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
