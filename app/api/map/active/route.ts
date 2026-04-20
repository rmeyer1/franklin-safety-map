import { NextResponse } from "next/server";

import { createIncidentRepository } from "@/lib/repositories/incidents";

export async function GET() {
  const repository = createIncidentRepository();
  const incidents = await repository.listActive();

  return NextResponse.json(incidents);
}

