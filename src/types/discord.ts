export interface DiscordGuild {
  id: string;
  name: string;
  icon?: string;
  owner_id: string;
  member_count: number;
  is_active: boolean;
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface DiscordUser {
  id: string;
  username: string;
  discriminator?: string;
  avatar?: string;
  bot: boolean;
  system: boolean;
  mfa_enabled: boolean;
  verified: boolean;
  email?: string;
  locale?: string;
  flags: number;
  premium_type: number;
  public_flags: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DiscordChannel {
  id: string;
  guild_id: string;
  name: string;
  type: number;
  position: number;
  topic?: string;
  nsfw: boolean;
  parent_id?: string;
  permissions: Record<string, any>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DiscordInteraction {
  id: string;
  type: number;
  guild_id?: string;
  channel_id?: string;
  user_id: string;
  command_name?: string;
  command_options: Record<string, any>;
  response_time_ms?: number;
  success: boolean;
  error_message?: string;
  created_at: string;
}

export interface DiscordUserLink {
  discord_user_id: string;
  auth_user_id: string;
  linked_at: string;
}

export interface DiscordConversation {
  id: string;
  conversation_id: string;
  guild_id: string;
  channel_id: string;
  discord_user_id: string;
  interaction_id?: string;
  thread_id?: string;
  is_private: boolean;
  created_at: string;
  updated_at: string;
}

export interface DiscordGuildSettings {
  guild_id: string;
  allowed_channels: string[];
  blocked_channels: string[];
  admin_roles: string[];
  rate_limit_per_user: number;
  rate_limit_window_minutes: number;
  max_question_length: number;
  enable_context_memory: boolean;
  response_language: string;
  custom_system_prompt?: string;
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface DiscordRateLimit {
  id: string;
  discord_user_id: string;
  guild_id: string;
  command_name: string;
  request_count: number;
  window_start: string;
  window_end: string;
  created_at: string;
  updated_at: string;
}

export interface CreateDiscordGuildInput {
  id: string;
  name: string;
  icon?: string;
  owner_id: string;
  member_count?: number;
  settings?: Record<string, any>;
}

export interface CreateDiscordUserInput {
  id: string;
  username: string;
  discriminator?: string;
  avatar?: string;
  bot?: boolean;
  system?: boolean;
  mfa_enabled?: boolean;
  verified?: boolean;
  email?: string;
  locale?: string;
  flags?: number;
  premium_type?: number;
  public_flags?: number;
}

export interface CreateDiscordChannelInput {
  id: string;
  guild_id: string;
  name: string;
  type: number;
  position?: number;
  topic?: string;
  nsfw?: boolean;
  parent_id?: string;
  permissions?: Record<string, any>;
}

export interface CreateDiscordInteractionInput {
  id: string;
  type: number;
  guild_id?: string;
  channel_id?: string;
  user_id: string;
  command_name?: string;
  command_options?: Record<string, any>;
  response_time_ms?: number;
  success?: boolean;
  error_message?: string;
}

export interface CreateDiscordConversationInput {
  conversation_id: string;
  guild_id: string;
  channel_id: string;
  discord_user_id: string;
  interaction_id?: string;
  thread_id?: string;
  is_private?: boolean;
}

export interface UpdateDiscordGuildSettingsInput {
  allowed_channels?: string[];
  blocked_channels?: string[];
  admin_roles?: string[];
  rate_limit_per_user?: number;
  rate_limit_window_minutes?: number;
  max_question_length?: number;
  enable_context_memory?: boolean;
  response_language?: string;
  custom_system_prompt?: string;
  settings?: Record<string, any>;
}