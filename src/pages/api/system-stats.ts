import type { APIRoute } from "astro";
import { apiJsonResponse, getDefaultLocalApi } from "../../server/api";

export const prerender = false;

export const GET: APIRoute = () =>
  apiJsonResponse(getDefaultLocalApi().getSystemStats());
