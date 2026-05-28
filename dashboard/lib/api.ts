import axios from "axios";
import { safeGet } from "@/lib/storage";

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

export const api = axios.create({ baseURL: BACKEND_URL });

api.interceptors.request.use((config) => {
  const token = safeGet("jfnn_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
