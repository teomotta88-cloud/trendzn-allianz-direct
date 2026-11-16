import { createFileRoute, redirect } from "@tanstack/react-router";

// Vecchio indirizzo: reindirizza alla nuova pagina.
export const Route = createFileRoute("/people")({
  beforeLoad: () => {
    throw redirect({ to: "/the-smartness-effect", replace: true });
  },
});
