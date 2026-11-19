import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // native / heavy server-only packages stay out of the bundle
  serverExternalPackages: ['sharp', 'mongoose', 'bcryptjs'],
  // dev servers reached through a public tunnel (ngrok / devtunnels) so Instagram can fetch /uploads
  allowedDevOrigins: ['*.ngrok-free.app', '*.ngrok.app', '*.devtunnels.ms', '*.trycloudflare.com'],
};

export default nextConfig;
