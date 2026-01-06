import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

const queryClient = new QueryClient();

function App() {
  const { data, isError } = useQuery({
    queryKey: ["health"],
    queryFn: () => fetch("/api/health").then((r) => r.json()),
    refetchInterval: 5000,
  });

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Game WebTransport</h1>
        {data && !isError ? (
          <>
            <p className="text-green-500">● Connected</p>
            <p className="text-slate-400 text-sm">
              Uptime: {Math.floor(data.uptime / 1000)}s
            </p>
          </>
        ) : (
          <p className="text-red-500">● Disconnected</p>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
