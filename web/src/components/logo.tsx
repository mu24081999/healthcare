"use client";

import { CSSProperties } from "react";
import { useClinic } from "@/components/clinic-provider";

interface LogoProps {
  style?: CSSProperties;
}

export function Logo({ style }: LogoProps) {
  const { clinic } = useClinic();

  if (clinic?.logo) {
    return (
      <img
        src={clinic.logo}
        alt="Clinic Logo"
        style={{
          width: "2rem",
          height: "2rem",
          objectFit: "contain",
          borderRadius: "4px",
          ...style,
        }}
      />
    );
  }

  return (
    <div
      style={{
        textAlign: "center",
        fontSize: "2rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      🏥
    </div>
  );
}
