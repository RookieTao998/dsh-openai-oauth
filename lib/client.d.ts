import { ReactNode } from "react";
import { Context } from "@deepseek-ai/cordis";
import { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import { SettingsSectionOwnerProps } from "@deepseek-ai/dsh-client-ui-settings/client";
import { OAuthLocaleKey } from "./locales.ts";
import { OAuthRequest } from "./transport.ts";

//#region src/client/index.d.ts
type ClientContext = Omit<Context, 'connection'> & {
  connection: ConnectionHandle;
};
interface OpenAiOAuthSectionInjected {
  t: (key: OAuthLocaleKey, params?: Record<string, string | number>) => string;
  request: OAuthRequest;
}
type OpenAiOAuthSectionProps = SettingsSectionOwnerProps & OpenAiOAuthSectionInjected;
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Dedicated OpenAI OAuth settings copy. */
    'settings.openai-oauth': OAuthLocaleKey;
  }
}
/** Dedicated settings section for the plugin-owned OAuth state machine. */
declare function OpenAiOAuthSection({
  t,
  request
}: OpenAiOAuthSectionProps): ReactNode;
declare const inject: string[];
/** Register bilingual copy and the dedicated settings page. */
declare function apply(ctx: ClientContext): void;
//#endregion
export { OpenAiOAuthSection, OpenAiOAuthSectionInjected, OpenAiOAuthSectionProps, apply, inject };