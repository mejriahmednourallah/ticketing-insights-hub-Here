console.log("ticketing edge router started");

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  const serviceName = url.pathname.split("/").filter(Boolean)[0];
  if (!serviceName) {
    return Response.json({ error: "Missing function name" }, { status: 400 });
  }

  const servicePath = `/home/deno/functions/${serviceName}`;
  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: 192,
      workerTimeoutMs: 120_000,
      noModuleCache: false,
      importMapPath: null,
      envVars: Object.entries(Deno.env.toObject()),
    });
    return await worker.fetch(request);
  } catch (error) {
    console.error(`[edge-router] ${serviceName} failed`, error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
