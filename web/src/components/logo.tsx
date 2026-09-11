"use client";

import { CSSProperties } from "react";
import { useClinic } from "@/components/clinic-provider";

interface LogoProps {
  style?: CSSProperties;
  variation?: "light" | "dark";
}

export function Logo({ style, variation = "dark" }: LogoProps) {
  const { clinic } = useClinic();

  if (clinic?.logo) {
    return (
      <img
        src={clinic.logo}
        alt="Clinic Logo"
        style={{
          width: "15rem",
          height: "5rem",
          objectFit: "contain",
          borderRadius: "4px",
          ...style,
        }}
      />
    );
  }

  const logoSrc = variation === "light" ? "/logo_light.png" : "/logo_dark.png";

  return (
    <img
      src={logoSrc}
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
