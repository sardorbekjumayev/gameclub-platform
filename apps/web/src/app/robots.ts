import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:4710";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/profile", "/bookings", "/favorites", "/notifications", "/pay", "/login", "/api/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
