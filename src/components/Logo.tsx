import { CSSProperties } from "react";
import { useClinic } from "./ClinicProvider";

interface LogoProps {
  style?: CSSProperties;
  sidebarSize?: string | number; // Accepts values like "3rem", "40px", or raw numbers
}

export function Logo({ style, sidebarSize }: LogoProps) {
  const { clinic } = useClinic();

  // If sidebarSize is a raw number, append 'px'. If it's a string (e.g., "2rem"), use it directly.
  const dynamicSize = sidebarSize 
    ? (typeof sidebarSize === "number" ? `${sidebarSize}px` : sidebarSize) 
    : "2rem"; // Default fallback size for the clinic logo if no prop is provided

  // Shared responsive styles
  const logoStyles: CSSProperties = {
    width: dynamicSize,
    height: dynamicSize,
    objectFit: "contain",
    borderRadius: "4px",
    ...style,
  };

  if (clinic?.logo) {
    return (
      <img
        src="/logo.png" 
        alt="Clinic Logo"
        style={logoStyles}
      />
    );
  }

  return (
    <img
      src="/logo.png" 
      alt="Default Clinic Logo"
      style={{
        ...logoStyles,
        // If sidebarSize isn't passed at all, it can fall back to a default height override if needed
        height:  "auto", 
        width: sidebarSize ? dynamicSize : "200px",
      }}
    />
  );
}