import { createServerFn } from "@tanstack/react-start";

const BROWSE_AI_API = "https://api.browse.ai/v2";

function getCreds() {
  const apiKey = process.env.BROWSE_AI_API_KEY;
  const robotId = process.env.BROWSE_AI_ROBOT_ID;
  if (!apiKey) throw new Error("BROWSE_AI_API_KEY no configurada");
  if (!robotId) throw new Error("BROWSE_AI_ROBOT_ID no configurada");
  return { apiKey, robotId };
}

export const startBrowseAiTask = createServerFn({ method: "POST" }).handler(
  async () => {
    const { apiKey, robotId } = getCreds();
    const res = await fetch(`${BROWSE_AI_API}/robots/${robotId}/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputParameters: {} }),
    });
    const json: any = await res.json();
    if (!res.ok) {
      return {
        ok: false as const,
        error: `Browse.ai ${res.status}: ${JSON.stringify(json)}`,
      };
    }
    const taskId = json?.result?.id ?? json?.id;
    if (!taskId) {
      return { ok: false as const, error: "Respuesta sin task id" };
    }
    return { ok: true as const, taskId };
  },
);

export const getBrowseAiTask = createServerFn({ method: "POST" })
  .inputValidator((data: { taskId: string }) => {
    if (!data?.taskId || typeof data.taskId !== "string") {
      throw new Error("taskId requerido");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const { apiKey, robotId } = getCreds();
    const res = await fetch(
      `${BROWSE_AI_API}/robots/${robotId}/tasks/${data.taskId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    const json: any = await res.json();
    if (!res.ok) {
      return {
        ok: false as const,
        error: `Browse.ai ${res.status}: ${JSON.stringify(json)}`,
      };
    }
    const task = json?.result ?? json;
    return {
      ok: true as const,
      status: task?.status as string,
      capturedLists: task?.capturedLists ?? null,
      capturedTexts: task?.capturedTexts ?? null,
      finishedAt: task?.finishedAt ?? null,
    };
  });
