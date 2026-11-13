"use client";

export function LogoutButton() {
  return (
    <button
      type="button"
      className="ops-link"
      onClick={async () => {
        try { await fetch("/api/ops/login", { method: "DELETE" }); } finally { window.location.reload(); }
      }}
    >
      Log out
    </button>
  );
}
