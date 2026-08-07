import { PROVIDER_ADAPTER_VERSIONS } from "./constitution.mjs";

function text(value, max = 500) { return String(value ?? "").trim().slice(0, max); }
function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function iso(value) { const date = value ? new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value) : null; return date && Number.isFinite(date.getTime()) ? date.toISOString() : null; }

export function normalizeIgdbGame(game, now = new Date().toISOString()) {
  const releaseDates = Array.isArray(game?.release_dates) ? game.release_dates : [];
  const future = releaseDates.map((item) => ({ ...item, at: iso(item.date || item.date_human) })).filter((item) => item.at && item.at > now).sort((a, b) => a.at.localeCompare(b.at));
  const next = future[0] || null;
  const websites = Array.isArray(game?.websites) ? game.websites : [];
  const official = websites.find((item) => item?.trusted === true || [1, 13].includes(Number(item?.category)))?.url || game?.url || "";
  return {
    provider: "igdb",
    adapter_version: PROVIDER_ADAPTER_VERSIONS.igdb,
    signal_type: next ? "upcoming_release" : "entity_updated",
    entity_type: "game",
    entity_id: text(game?.id, 100),
    canonical_url: text(official, 2048),
    title: text(game?.name, 300),
    description: text(game?.summary, 1200),
    atinara_category: "Lanzamientos",
    observed_at: now,
    source_updated_at: iso(game?.updated_at),
    event_start_at: next?.at || iso(game?.first_release_date),
    metric_name: null,
    metric_value: null,
    metric_unit: null,
    factual_basis: next?.at ? `IGDB registra una fecha futura para ${text(game?.name, 200)}.` : `IGDB actualizó la entidad ${text(game?.name, 200)}.`,
    provider_policy_flags: ["IGDB_SECONDARY_SOURCE", "OFFICIAL_SOURCE_REQUIRED_BEFORE_PUBLICATION"],
    retention_expires_at: null,
  };
}

export function normalizeTwitchStream(stream, now = new Date().toISOString()) {
  const viewers = number(stream?.viewer_count);
  return {
    provider: "twitch",
    adapter_version: PROVIDER_ADAPTER_VERSIONS.twitch,
    signal_type: "live_stream",
    entity_type: "user",
    entity_id: text(stream?.user_id, 100),
    parent_entity_id: text(stream?.game_id, 100) || null,
    canonical_url: stream?.user_login ? `https://www.twitch.tv/${encodeURIComponent(text(stream.user_login, 100))}` : "",
    title: text(stream?.user_name || stream?.title, 300),
    subtitle: text(stream?.game_name, 200),
    atinara_category: "Streamers",
    observed_at: now,
    source_updated_at: iso(stream?.started_at),
    event_start_at: iso(stream?.started_at),
    metric_name: "viewer_count",
    metric_value: viewers,
    metric_unit: "viewers",
    factual_basis: viewers === null ? "El directo está activo, pero la métrica pública no está disponible." : `Twitch informa de ${viewers} espectadores concurrentes en esta captura.`,
    provider_policy_flags: viewers === null ? ["MISSING_METRIC_NOT_ZERO"] : [],
    retention_expires_at: null,
  };
}

export function normalizeTwitchGame(game, rank, now = new Date().toISOString()) {
  const topRank = number(rank);
  return {
    provider: "twitch",
    adapter_version: PROVIDER_ADAPTER_VERSIONS.twitch,
    signal_type: "top_game",
    entity_type: "game",
    entity_id: text(game?.id, 100),
    canonical_url: game?.name ? `https://www.twitch.tv/search?term=${encodeURIComponent(text(game.name, 200))}` : "https://www.twitch.tv/directory",
    title: text(game?.name, 300),
    atinara_category: "Gaming",
    observed_at: now,
    source_updated_at: null,
    metric_name: "top_category_rank",
    metric_value: topRank,
    metric_unit: "rank",
    factual_basis: topRank === null ? "Twitch incluye el juego entre sus categorías destacadas, sin un puesto utilizable." : `Twitch sitúa el juego en el puesto ${topRank} de categorías destacadas en esta captura.`,
    marketability_status: "insufficient_history",
    provider_policy_flags: ["TWITCH_TOP_GAMES_DISCOVERY_ONLY", "HISTORY_REQUIRED_FOR_THRESHOLD"],
    retention_expires_at: null,
  };
}

export function normalizeYouTubeChannel(channel, now = new Date().toISOString()) {
  const statistics = channel?.statistics || {};
  const hidden = statistics.hiddenSubscriberCount === true;
  const subscribers = hidden ? null : number(statistics.subscriberCount);
  return {
    provider: "youtube",
    adapter_version: PROVIDER_ADAPTER_VERSIONS.youtube,
    signal_type: "public_channel_metric",
    entity_type: "channel",
    entity_id: text(channel?.id, 100),
    canonical_url: channel?.id ? `https://www.youtube.com/channel/${encodeURIComponent(text(channel.id, 100))}` : "",
    title: text(channel?.snippet?.title, 300),
    description: text(channel?.snippet?.description, 1200),
    atinara_category: "YouTubers",
    observed_at: now,
    source_updated_at: null,
    metric_name: "subscriberCount",
    metric_value: subscribers,
    metric_unit: "subscribers",
    metric_precision: subscribers === null ? null : "three_significant_figures_rounded_down",
    metric_is_rounded: subscribers !== null,
    factual_basis: hidden ? "El canal oculta el recuento de suscriptores." : `YouTube devuelve un recuento público redondeado de ${subscribers ?? "valor ausente"} suscriptores.`,
    provider_policy_flags: hidden ? ["HIDDEN_METRIC", "MISSING_METRIC_NOT_ZERO"] : ["ROUNDED_DOWN_THREE_SIGNIFICANT_FIGURES"],
    retention_expires_at: new Date(new Date(now).getTime() + 30 * 86400000).toISOString(),
  };
}

export function normalizeYouTubeVideo(video, now = new Date().toISOString()) {
  const live = video?.liveStreamingDetails || {};
  const concurrent = number(live.concurrentViewers);
  const completed = Boolean(live.actualEndTime);
  return {
    provider: "youtube",
    adapter_version: PROVIDER_ADAPTER_VERSIONS.youtube,
    signal_type: live.scheduledStartTime ? completed ? "live_completed" : live.actualStartTime ? "live_active" : "live_scheduled" : "video_published",
    entity_type: "video",
    entity_id: text(video?.id, 100),
    canonical_url: video?.id ? `https://www.youtube.com/watch?v=${encodeURIComponent(text(video.id, 100))}` : "",
    title: text(video?.snippet?.title, 300),
    description: text(video?.snippet?.description, 1200),
    atinara_category: "YouTubers",
    observed_at: now,
    source_updated_at: iso(video?.snippet?.publishedAt),
    event_start_at: iso(live.scheduledStartTime || live.actualStartTime),
    event_end_at: iso(live.actualEndTime),
    metric_name: live.scheduledStartTime ? "concurrentViewers" : "viewCount",
    metric_value: live.scheduledStartTime ? concurrent : number(video?.statistics?.viewCount),
    metric_unit: "viewers",
    factual_basis: completed && concurrent === null ? "La emisión terminó y YouTube ya no ofrece concurrentViewers; solo son válidas capturas previas." : "YouTube devuelve una métrica pública de este contenido.",
    provider_policy_flags: completed && concurrent === null ? ["CONCURRENT_VIEWERS_ABSENT_AFTER_END", "SNAPSHOTS_REQUIRED"] : [],
    retention_expires_at: new Date(new Date(now).getTime() + 30 * 86400000).toISOString(),
  };
}

export function youtubeProposalPolicy(signal) {
  const issues = [];
  if (signal?.head_to_head) issues.push("YOUTUBE_HEAD_TO_HEAD_PROHIBITED");
  if (signal?.channel_score) issues.push("YOUTUBE_CHANNEL_SCORE_PROHIBITED");
  if (signal?.mixed_provider_metric) issues.push("YOUTUBE_PROVIDER_MIX_PROHIBITED");
  if (signal?.metric_value === null || signal?.metric_value === undefined) issues.push("YOUTUBE_METRIC_UNAVAILABLE");
  if (signal?.retention_expires_at && new Date(signal.retention_expires_at) <= new Date(signal?.evaluation_at || 0)) issues.push("SOURCE_RETENTION_INCOMPATIBLE");
  return issues;
}
