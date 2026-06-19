import { createFileRoute } from "@tanstack/react-router";
import { listNotes } from "../server/notes-fn";

export const Route = createFileRoute("/")({
  loader: async () => ({ notes: await listNotes() }),
  component: Home,
});

function Home() {
  const { notes } = Route.useLoaderData();
  return (
    <main>
      <h1>Veritra spike</h1>
      <ul>
        {notes.map((n) => (
          <li key={n.id}>{n.body}</li>
        ))}
      </ul>
      <a href="/login">login</a>
    </main>
  );
}
