import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function handleRouteError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Validation error",
        details: error.flatten()
      },
      { status: 400 }
    );
  }

  if (error instanceof Error) {
    return NextResponse.json(
      {
        error: error.message
      },
      { status: 400 }
    );
  }

  return NextResponse.json(
    {
      error: "Unexpected server error"
    },
    { status: 500 }
  );
}
