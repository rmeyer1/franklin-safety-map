import { getEnv } from "@/lib/config/env";
import { geocodingResultSchema, type GeocodingResult } from "@/lib/types/domain";

const WARREN_COUNTY_CENTER = {
  lat: 39.43,
  lng: -84.21,
};

type GeocodeInput = {
  address?: string | null;
  locationText?: string | null;
  label?: string | null;
};

function buildQuery(input: GeocodeInput): string | null {
  const candidates = [input.address, input.locationText, input.label]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value && value.length > 0));

  if (candidates.length === 0) {
    return null;
  }

  return `${candidates[0]}, Warren County, Ohio`;
}

function unresolvedResult(input: {
  query: string | null;
  reason: string;
}): GeocodingResult {
  return geocodingResultSchema.parse({
    provider: "county_bias",
    resolved: false,
    confidence: 0.15,
    query: input.query,
    reason: input.reason,
    point: WARREN_COUNTY_CENTER,
  });
}

export interface GeocodingService {
  geocode(input: GeocodeInput): Promise<GeocodingResult>;
}

export class ProviderFallbackGeocodingService implements GeocodingService {
  async geocode(input: GeocodeInput): Promise<GeocodingResult> {
    const query = buildQuery(input);
    if (!query) {
      return unresolvedResult({
        query: null,
        reason: "missing_location_text",
      });
    }

    const env = getEnv();
    if (!env.MAPBOX_ACCESS_TOKEN) {
      return unresolvedResult({
        query,
        reason: "mapbox_unconfigured",
      });
    }

    const url = new URL(
      `https://api.mapbox.com/search/geocode/v6/forward`,
    );
    url.searchParams.set("q", query);
    url.searchParams.set("access_token", env.MAPBOX_ACCESS_TOKEN);
    url.searchParams.set("limit", "1");
    url.searchParams.set("country", "US");
    url.searchParams.set("types", "address,street,place,locality,neighborhood");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return unresolvedResult({
        query,
        reason: `mapbox_http_${response.status}`,
      });
    }

    const payload = (await response.json()) as {
      features?: Array<{
        properties?: {
          coordinates?: {
            latitude?: number;
            longitude?: number;
          };
          match_code?: {
            confidence?: string;
          };
        };
      }>;
    };

    const feature = payload.features?.[0];
    const lat = feature?.properties?.coordinates?.latitude;
    const lng = feature?.properties?.coordinates?.longitude;

    if (typeof lat !== "number" || typeof lng !== "number") {
      return unresolvedResult({
        query,
        reason: "mapbox_no_result",
      });
    }

    const matchConfidence = feature?.properties?.match_code?.confidence;
    const confidence =
      matchConfidence === "exact"
        ? 0.95
        : matchConfidence === "high"
          ? 0.85
          : matchConfidence === "medium"
            ? 0.7
            : 0.55;

    return geocodingResultSchema.parse({
      provider: "mapbox",
      resolved: true,
      confidence,
      query,
      reason: null,
      point: { lat, lng },
    });
  }
}

export function createGeocodingService(): GeocodingService {
  return new ProviderFallbackGeocodingService();
}
