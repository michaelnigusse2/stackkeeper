import type { FieldErrors } from "@stackkeeper/core";

export function FieldError({ errors, name }: { errors?: FieldErrors; name: string }) {
  const message = errors?.[name];
  if (!message) return null;
  return (
    <p className="error" id={`${name}-error`} role="alert">
      {message}
    </p>
  );
}

export function FormNotice({ message, tone = "error" }: { message?: string; tone?: "error" | "ok" | "warning" }) {
  if (!message) return null;
  return (
    <p className={`notice ${tone}`} role={tone === "error" ? "alert" : "status"}>
      {message}
    </p>
  );
}
