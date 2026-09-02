import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AlarmClock, ChevronDown, ChevronUp, Footprints, Route, Sparkles } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { theme } from '@/src/constants/theme';
import { FadeInView, PressableScale } from '@/src/components/ui/motion';
import type { PatternInsights } from '@/src/utils/patternEngine';

interface InsightCardData {
  key: string;
  title: string;
  body: string;
  icon: LucideIcon;
}

interface Props {
  insights: PatternInsights;
  dismissedKeys: string[];
  onDismiss: (key: string) => void;
}

const MAX_VISIBLE = 2;

/** One insight card — icon halo keyed to the insight type, never color-only. */
function InsightCard({ card, dimmed, onDismiss }: {
  card: InsightCardData;
  dimmed?: boolean;
  onDismiss?: (key: string) => void;
}) {
  const Icon = card.icon;
  return (
    <View style={[styles.card, dimmed && styles.cardDismissed]}>
      <View style={[styles.iconHalo, dimmed && styles.iconHaloDismissed]}>
        <Icon size={15} color={dimmed ? theme.colors.textMuted : theme.colors.brandInk} strokeWidth={2} />
      </View>
      <View style={styles.cardContent}>
        <Text style={[styles.cardTitle, dimmed && styles.cardTitleDismissed]}>{card.title}</Text>
        <Text style={[styles.cardBody, dimmed && styles.cardBodyDismissed]}>{card.body}</Text>
      </View>
      {onDismiss && (
        <PressableScale
          haptic={false}
          onPress={() => onDismiss(card.key)}
          hitSlop={8}
          style={styles.dismissBtn}
          accessibilityRole="button"
          accessibilityLabel={`Got it, dismiss ${card.title}`}
        >
          <Text style={styles.dismissBtnText}>Got it</Text>
        </PressableScale>
      )}
    </View>
  );
}

export default function PatternInsightCards({ insights, dismissedKeys, onDismiss }: Props) {
  const [showAllNew, setShowAllNew] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);

  // Build all insight cards
  const allCards: InsightCardData[] = [];

  for (const w of insights.walkTimeInsights) {
    const key = `walk_${w.originLabel}_${w.destinationLabel}`;
    const faster = w.diffMinutes > 0;
    const absDiff = Math.abs(w.diffMinutes);
    const body = faster
      ? `Your walk to ${w.destinationLabel} takes ~${Math.round(w.personalMinutes)} min, not the estimated ${Math.round(w.estimatedMinutes)}. We've updated your leave times.`
      : `Your walk to ${w.destinationLabel} takes ~${Math.round(w.personalMinutes)} min — ${absDiff.toFixed(0)} min longer than estimated. We've adjusted your leave times.`;
    allCards.push({ key, title: 'Walk time updated', body, icon: Footprints });
  }

  for (const h of insights.departureHabits) {
    if (h.avgLatenessMinutes > 0) {
      const key = `habit_${h.classId}`;
      const mins = Math.abs(Math.round(h.avgLatenessMinutes));
      const body = `You tend to leave ${mins}min after we suggest — we've adjusted your alerts to account for this.`;
      allCards.push({ key, title: 'Departure habit noticed', body, icon: AlarmClock });
    }
  }

  for (const r of insights.routePreferences) {
    const key = `route_${r.context}`;
    const body = `You usually take Route ${r.preferredRoute} — we'll always show it first.`;
    allCards.push({ key, title: 'Route preference learned', body, icon: Route });
  }

  const newCards = allCards.filter((c) => !dismissedKeys.includes(c.key));
  const dismissedCards = allCards.filter((c) => dismissedKeys.includes(c.key));

  if (allCards.length === 0) return null;

  const visibleNew = showAllNew ? newCards : newCards.slice(0, MAX_VISIBLE);
  const hiddenNewCount = newCards.length - MAX_VISIBLE;

  return (
    <View style={styles.container}>
      {newCards.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <Sparkles size={12} color={theme.colors.brandInk} strokeWidth={2.2} />
            <Text style={styles.sectionHeaderText} accessibilityRole="header">Your patterns</Text>
          </View>

          {visibleNew.map((card, i) => (
            <FadeInView key={card.key} delay={i * 60} dy={10}>
              <InsightCard card={card} onDismiss={onDismiss} />
            </FadeInView>
          ))}

          {!showAllNew && hiddenNewCount > 0 && (
            <PressableScale
              haptic={false}
              onPress={() => setShowAllNew(true)}
              style={styles.seeMoreBtn}
              accessibilityRole="button"
              accessibilityLabel={`See ${hiddenNewCount} more insights`}
            >
              <ChevronDown size={14} color={theme.colors.brandInk} strokeWidth={2.2} />
              <Text style={styles.seeMoreText}>See {hiddenNewCount} more</Text>
            </PressableScale>
          )}
        </>
      )}

      {dismissedCards.length > 0 && (
        <View style={styles.dismissedSection}>
          <PressableScale
            haptic={false}
            onPress={() => setShowDismissed((v) => !v)}
            style={styles.dismissedToggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: showDismissed }}
            accessibilityLabel={
              showDismissed
                ? 'Hide learnings about your commute'
                : `Show all ${dismissedCards.length} learnings about your commute`
            }
          >
            {showDismissed ? (
              <ChevronUp size={14} color={theme.colors.textSecondary} strokeWidth={2.2} />
            ) : (
              <ChevronDown size={14} color={theme.colors.textSecondary} strokeWidth={2.2} />
            )}
            <Text style={styles.dismissedToggleText}>
              {showDismissed ? 'Hide' : `Show all ${dismissedCards.length} learning${dismissedCards.length > 1 ? 's' : ''}`} — About your commute
            </Text>
          </PressableScale>

          {showDismissed &&
            dismissedCards.map((card, i) => (
              <FadeInView key={card.key} delay={i * 50} dy={8}>
                <InsightCard card={card} dimmed />
              </FadeInView>
            ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: theme.spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionHeaderText: {
    ...theme.text.eyebrow,
    color: theme.colors.textMuted,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: 14,
    marginBottom: theme.spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.orange,
    flexDirection: 'row',
    alignItems: 'flex-start',
    ...theme.elevation[1],
  },
  cardDismissed: {
    borderLeftColor: theme.colors.border,
    opacity: 0.75,
  },
  iconHalo: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.colors.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  iconHaloDismissed: {
    backgroundColor: theme.colors.surfaceAlt,
  },
  cardContent: {
    flex: 1,
    marginRight: 10,
  },
  cardTitle: {
    ...theme.text.subhead,
    fontSize: 14,
    color: theme.colors.navy,
    marginBottom: 3,
  },
  cardTitleDismissed: {
    color: theme.colors.textSecondary,
  },
  cardBody: {
    ...theme.text.caption,
    color: theme.colors.textSecondary,
  },
  cardBodyDismissed: {
    color: theme.colors.textMuted,
  },
  dismissBtn: {
    minHeight: theme.layout.tapMin,
    justifyContent: 'center',
  },
  dismissBtnText: {
    ...theme.text.badge,
    color: theme.colors.brandInk,
  },
  seeMoreBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: theme.layout.tapMin,
    paddingVertical: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  seeMoreText: {
    ...theme.text.badge,
    fontSize: 13,
    color: theme.colors.brandInk,
  },
  dismissedSection: {
    marginTop: 4,
  },
  dismissedToggle: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: theme.layout.tapMin,
    paddingVertical: theme.spacing.sm,
    marginBottom: 4,
  },
  dismissedToggleText: {
    ...theme.text.badge,
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
    color: theme.colors.textSecondary,
  },
});
