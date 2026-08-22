import {
  ServiceManagerRequestError,
  getManagedServiceStatus,
  restartManagedService,
} from "@/lib/service-manager-client.mjs";

export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function errorResponse(error: unknown) {
  if (error instanceof ServiceManagerRequestError) {
    return noStoreJson({ ok: false, code: error.code, message: error.message }, error.status);
  }
  return noStoreJson({ ok: false, code: "SERVICE_CONTROL_FAILED", message: "服务控制操作失败" }, 500);
}

function isSameSiteRequest(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none";
}

function scheduleRestart() {
  const timer = setTimeout(() => {
    void restartManagedService().catch((error) => {
      console.error("Scheduled Writer Studio restart failed", error);
    });
  }, 750);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

export async function GET() {
  try {
    const status = await getManagedServiceStatus();
    return noStoreJson({ ok: true, ...status });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isSameSiteRequest(request)) {
    return noStoreJson({ ok: false, code: "CROSS_SITE_REQUEST", message: "拒绝跨站服务控制请求" }, 403);
  }

  try {
    const status = await getManagedServiceStatus();
    if (!status.service.managed) {
      return noStoreJson({
        ok: false,
        code: "SERVICE_NOT_MANAGED",
        message: "当前服务不是由 3003 服务管理器启动，无法在应用内重启",
      }, 409);
    }
    if (status.operation !== "idle") {
      return noStoreJson({ ok: false, code: "MANAGER_BUSY", message: "服务管理器正在执行其他操作，请稍后再试" }, 409);
    }
    if (status.service.state !== "running") {
      return noStoreJson({ ok: false, code: "SERVICE_NOT_READY", message: "服务端当前未处于可重启状态" }, 409);
    }

    scheduleRestart();
    return noStoreJson({
      ok: true,
      accepted: true,
      message: "服务端重启请求已受理",
      previousStartedAt: status.service.startedAt ?? null,
    }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
