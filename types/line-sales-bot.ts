export type LineWebhookEventLogRow = {
  id: string;
  received_at: string;
  source_type: string | null;
  message_text: string | null;
  bot_reply_status: string | null;
  bot_reply_error: string | null;
};

export type LineSalesBotDiagnostics = {
  line_oa_basic_id: string | null;
  line_webhook_url: string | null;
  line_webhook_last_verified_at: string | null;
  recommended_webhook_url: string | null;
  is_stale_deployment_url: boolean;
  events: LineWebhookEventLogRow[];
  error: string | null;
};
