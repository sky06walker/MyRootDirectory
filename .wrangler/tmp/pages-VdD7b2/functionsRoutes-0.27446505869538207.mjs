import { onRequestPost as __api_change_password_ts_onRequestPost } from "C:\\Users\\weihon\\Documents\\Source\\Github\\MyRootDirectory\\functions\\api\\change-password.ts"
import { onRequestGet as __api_content_ts_onRequestGet } from "C:\\Users\\weihon\\Documents\\Source\\Github\\MyRootDirectory\\functions\\api\\content.ts"
import { onRequestPost as __api_content_ts_onRequestPost } from "C:\\Users\\weihon\\Documents\\Source\\Github\\MyRootDirectory\\functions\\api\\content.ts"
import { onRequestPost as __api_login_ts_onRequestPost } from "C:\\Users\\weihon\\Documents\\Source\\Github\\MyRootDirectory\\functions\\api\\login.ts"
import { onRequestPost as __api_logout_ts_onRequestPost } from "C:\\Users\\weihon\\Documents\\Source\\Github\\MyRootDirectory\\functions\\api\\logout.ts"
import { onRequestGet as __api_verify_ts_onRequestGet } from "C:\\Users\\weihon\\Documents\\Source\\Github\\MyRootDirectory\\functions\\api\\verify.ts"

export const routes = [
    {
      routePath: "/api/change-password",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_change_password_ts_onRequestPost],
    },
  {
      routePath: "/api/content",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_content_ts_onRequestGet],
    },
  {
      routePath: "/api/content",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_content_ts_onRequestPost],
    },
  {
      routePath: "/api/login",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_login_ts_onRequestPost],
    },
  {
      routePath: "/api/logout",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_logout_ts_onRequestPost],
    },
  {
      routePath: "/api/verify",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_verify_ts_onRequestGet],
    },
  ]