import { Cloud, CloudFog, CloudRain, Snowflake, Sun, Wind, type LucideIcon } from "lucide-react";

import { WEATHER_LABELS, type WeatherCondition } from "@/shared/reports";

import { cn } from "../../lib/cn";
import { formatTemperature } from "./lib";

export const WEATHER_ICONS: Record<WeatherCondition, LucideIcon> = {
  soleil: Sun,
  nuageux: Cloud,
  pluie: CloudRain,
  neige: Snowflake,
  vent: Wind,
  brouillard: CloudFog,
};

/**
 * "Neige, −12 °C" with its icon; nothing when the weather was not noted.
 * `short` leaves the word to the icon on a phone, where a line of the list
 * has the day to show first.
 */
export function WeatherLine({
  condition,
  temperatureC,
  short,
  className,
}: {
  condition: WeatherCondition | null;
  temperatureC: number | null;
  short?: boolean;
  className?: string;
}) {
  if (!condition && temperatureC === null) return null;
  const Icon = condition ? WEATHER_ICONS[condition] : null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      {Icon ? <Icon className="text-ead-dark size-4.5 shrink-0" aria-hidden /> : null}
      <span>
        {condition ? (
          <span className={cn(short && temperatureC !== null && "max-sm:sr-only")}>
            {WEATHER_LABELS[condition]}
            {temperatureC === null ? "" : ", "}
          </span>
        ) : null}
        {temperatureC === null ? null : formatTemperature(temperatureC)}
      </span>
    </span>
  );
}
