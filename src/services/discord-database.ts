import { supabase } from '../config/database';
import logger from '../utils/logger';
import {
  DiscordGuild,
  DiscordUser,
  DiscordChannel,
  DiscordInteraction,
  DiscordConversation,
  DiscordGuildSettings,
  DiscordRateLimit,
  CreateDiscordGuildInput,
  CreateDiscordUserInput,
  CreateDiscordChannelInput,
  CreateDiscordInteractionInput,
  CreateDiscordConversationInput,
  UpdateDiscordGuildSettingsInput
} from '../types/discord';

export class DiscordDatabaseService {
  // Guild operations
  async createGuild(input: CreateDiscordGuildInput): Promise<DiscordGuild> {
    const { data, error } = await supabase
      .from('discord_guilds')
      .insert({
        id: input.id,
        name: input.name,
        icon: input.icon,
        owner_id: input.owner_id,
        member_count: input.member_count || 0,
        settings: input.settings || {}
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getGuild(guildId: string): Promise<DiscordGuild | null> {
    const { data, error } = await supabase
      .from('discord_guilds')
      .select('*')
      .eq('id', guildId)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async upsertGuild(input: CreateDiscordGuildInput): Promise<DiscordGuild> {
    const { data, error } = await supabase
      .from('discord_guilds')
      .upsert({
        id: input.id,
        name: input.name,
        icon: input.icon,
        owner_id: input.owner_id,
        member_count: input.member_count || 0,
        settings: input.settings || {}
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async updateGuild(guildId: string, updates: Partial<DiscordGuild>): Promise<DiscordGuild> {
    const { data, error } = await supabase
      .from('discord_guilds')
      .update(updates)
      .eq('id', guildId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async deactivateGuild(guildId: string): Promise<void> {
    const { error } = await supabase
      .from('discord_guilds')
      .update({ is_active: false })
      .eq('id', guildId);

    if (error) throw error;
  }

  // User operations
  async createUser(input: CreateDiscordUserInput): Promise<DiscordUser> {
    const { data, error } = await supabase
      .from('discord_users')
      .insert({
        id: input.id,
        username: input.username,
        discriminator: input.discriminator,
        avatar: input.avatar,
        bot: input.bot || false,
        system: input.system || false,
        mfa_enabled: input.mfa_enabled || false,
        verified: input.verified || false,
        email: input.email,
        locale: input.locale,
        flags: input.flags || 0,
        premium_type: input.premium_type || 0,
        public_flags: input.public_flags || 0
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getUser(userId: string): Promise<DiscordUser | null> {
    const { data, error } = await supabase
      .from('discord_users')
      .select('*')
      .eq('id', userId)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async updateUser(userId: string, updates: Partial<DiscordUser>): Promise<DiscordUser> {
    const { data, error } = await supabase
      .from('discord_users')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async upsertUser(input: CreateDiscordUserInput): Promise<DiscordUser> {
    const { data, error } = await supabase
      .from('discord_users')
      .upsert({
        id: input.id,
        username: input.username,
        discriminator: input.discriminator,
        avatar: input.avatar,
        bot: input.bot || false,
        system: input.system || false,
        mfa_enabled: input.mfa_enabled || false,
        verified: input.verified || false,
        email: input.email,
        locale: input.locale,
        flags: input.flags || 0,
        premium_type: input.premium_type || 0,
        public_flags: input.public_flags || 0
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Channel operations
  async createChannel(input: CreateDiscordChannelInput): Promise<DiscordChannel> {
    const { data, error } = await supabase
      .from('discord_channels')
      .insert({
        id: input.id,
        guild_id: input.guild_id,
        name: input.name,
        type: input.type,
        position: input.position || 0,
        topic: input.topic,
        nsfw: input.nsfw || false,
        parent_id: input.parent_id,
        permissions: input.permissions || {}
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getChannel(channelId: string): Promise<DiscordChannel | null> {
    const { data, error } = await supabase
      .from('discord_channels')
      .select('*')
      .eq('id', channelId)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async getGuildChannels(guildId: string): Promise<DiscordChannel[]> {
    const { data, error } = await supabase
      .from('discord_channels')
      .select('*')
      .eq('guild_id', guildId)
      .eq('is_active', true)
      .order('position');

    if (error) throw error;
    return data || [];
  }

  async upsertChannel(input: CreateDiscordChannelInput): Promise<DiscordChannel> {
    const { data, error } = await supabase
      .from('discord_channels')
      .upsert({
        id: input.id,
        guild_id: input.guild_id,
        name: input.name,
        type: input.type,
        position: input.position || 0,
        topic: input.topic,
        nsfw: input.nsfw || false,
        parent_id: input.parent_id,
        permissions: input.permissions || {}
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Interaction operations
  async createInteraction(input: CreateDiscordInteractionInput): Promise<DiscordInteraction> {
    const { data, error } = await supabase
      .from('discord_interactions')
      .insert({
        id: input.id,
        type: input.type,
        guild_id: input.guild_id,
        channel_id: input.channel_id,
        user_id: input.user_id,
        command_name: input.command_name,
        command_options: input.command_options || {},
        response_time_ms: input.response_time_ms,
        success: input.success !== undefined ? input.success : true,
        error_message: input.error_message
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async updateInteraction(interactionId: string, updates: Partial<DiscordInteraction>): Promise<DiscordInteraction> {
    const { data, error } = await supabase
      .from('discord_interactions')
      .update(updates)
      .eq('id', interactionId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Conversation operations
  async createDiscordConversation(input: CreateDiscordConversationInput): Promise<DiscordConversation> {
    const { data, error } = await supabase
      .from('discord_conversations')
      .insert({
        conversation_id: input.conversation_id,
        guild_id: input.guild_id,
        channel_id: input.channel_id,
        discord_user_id: input.discord_user_id,
        interaction_id: input.interaction_id,
        thread_id: input.thread_id,
        is_private: input.is_private || false
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getDiscordConversation(conversationId: string): Promise<DiscordConversation | null> {
    const { data, error } = await supabase
      .from('discord_conversations')
      .select('*')
      .eq('conversation_id', conversationId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async getUserConversations(userId: string, guildId: string): Promise<DiscordConversation[]> {
    const { data, error } = await supabase
      .from('discord_conversations')
      .select('*')
      .eq('discord_user_id', userId)
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  // Guild settings operations
  async getGuildSettings(guildId: string): Promise<DiscordGuildSettings | null> {
    const { data, error } = await supabase
      .from('discord_guild_settings')
      .select('*')
      .eq('guild_id', guildId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async upsertGuildSettings(guildId: string, settings: UpdateDiscordGuildSettingsInput): Promise<DiscordGuildSettings> {
    const { data, error } = await supabase
      .from('discord_guild_settings')
      .upsert({
        guild_id: guildId,
        ...settings
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Rate limiting operations
  async checkRateLimit(userId: string, guildId: string, commandName: string): Promise<DiscordRateLimit | null> {
    const now = new Date();
    const { data, error } = await supabase
      .from('discord_rate_limits')
      .select('*')
      .eq('discord_user_id', userId)
      .eq('guild_id', guildId)
      .eq('command_name', commandName)
      .gte('window_end', now.toISOString())
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async updateRateLimit(userId: string, guildId: string, commandName: string, windowMinutes: number = 60): Promise<DiscordRateLimit> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - (windowMinutes * 60 * 1000));
    const windowEnd = new Date(now.getTime() + (windowMinutes * 60 * 1000));

    const existing = await this.checkRateLimit(userId, guildId, commandName);
    
    if (existing) {
      const { data, error } = await supabase
        .from('discord_rate_limits')
        .update({
          request_count: existing.request_count + 1,
          window_end: windowEnd.toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from('discord_rate_limits')
        .insert({
          discord_user_id: userId,
          guild_id: guildId,
          command_name: commandName,
          request_count: 1,
          window_start: windowStart.toISOString(),
          window_end: windowEnd.toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    }
  }

  async cleanupExpiredRateLimits(): Promise<void> {
    const now = new Date();
    const { error } = await supabase
      .from('discord_rate_limits')
      .delete()
      .lt('window_end', now.toISOString());

    if (error) throw error;
  }

  // User linking operations
  async linkDiscordUser(discordUserId: string, authUserId: string): Promise<void> {
    const { error } = await supabase
      .from('discord_user_links')
      .insert({
        discord_user_id: discordUserId,
        auth_user_id: authUserId
      });

    if (error) throw error;
  }

  async getLinkedAuthUser(discordUserId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('discord_user_links')
      .select('auth_user_id')
      .eq('discord_user_id', discordUserId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data?.auth_user_id || null;
  }

  async unlinkDiscordUser(discordUserId: string): Promise<void> {
    const { error } = await supabase
      .from('discord_user_links')
      .delete()
      .eq('discord_user_id', discordUserId);

    if (error) throw error;
  }

  // Auto-create auth user for Discord user if not exists
  async getOrCreateAuthUser(discordUserId: string, discordUsername: string): Promise<string> {
    // First check if user is already linked
    const existingLink = await this.getLinkedAuthUser(discordUserId);
    if (existingLink) {
      return existingLink;
    }

    try {
      // Create a simple auth user record using Discord ID as email
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: `discord_${discordUserId}@fbaboss.local`,
        password: 'discord_auto_generated_' + discordUserId,
        email_confirm: true,
        user_metadata: {
          discord_id: discordUserId,
          discord_username: discordUsername,
          auto_created: true
        }
      });

      if (authError) {
        logger.warn(`Failed to create auth user for Discord user ${discordUserId}:`, authError);
        // Return Discord user ID as fallback
        return discordUserId;
      }

      // Link the Discord user to the auth user
      await this.linkDiscordUser(discordUserId, authUser.user.id);
      
      logger.info(`Auto-created auth user for Discord user ${discordUserId}`);
      return authUser.user.id;

    } catch (error) {
      logger.error(`Error creating auth user for Discord user ${discordUserId}:`, error);
      // Return Discord user ID as fallback
      return discordUserId;
    }
  }
}