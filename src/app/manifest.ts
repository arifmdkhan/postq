import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PostQ Studio",
    short_name: "PostQ",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#faf7f2",
    theme_color: "#173df5",
    icons: [
      {src:"/postq.svg",sizes:"any",type:"image/svg+xml",purpose:"any"},
      {src:"/postq-192.png",sizes:"192x192",type:"image/png",purpose:"any"},
      {src:"/postq-512.png",sizes:"512x512",type:"image/png",purpose:"any"},
      {src:"/postq-maskable-512.png",sizes:"512x512",type:"image/png",purpose:"maskable"},
    ],
  };
}

