import type { NextConfig } from "next";

// Brauzer API'ni shu domen orqali chaqiradi (/api/v1/*) — tashqi IP/domendan ochilganda ham ishlaydi, CORS kerak emas.
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4700";

const nextConfig: NextConfig = {
  // Har bir panel (platform/club/desk) o'z build papkasiga — bir vaqtda uchta port.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API_ORIGIN}/api/v1/:path*` }];
  },
};

export default nextConfig;
