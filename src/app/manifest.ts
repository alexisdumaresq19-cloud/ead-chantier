import type { MetadataRoute } from "next";

// Lets phones, tablets and computers install the app on the home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    // The app keeps its identity if the start address ever changes.
    id: "/",
    name: "EAD Chantier",
    // Under the icon; the full name fits the twelve characters a phone shows.
    short_name: "EAD Chantier",
    description: "Plans, documents, photos et rapports journaliers des chantiers.",
    lang: "fr-CA",
    dir: "ltr",
    categories: ["business", "productivity"],
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Plans are read with the phone turned on its side.
    orientation: "any",
    // The black of the app's bars and of its first screen: no flash on launch.
    background_color: "#0b0d10",
    theme_color: "#0b0d10",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/brand/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
