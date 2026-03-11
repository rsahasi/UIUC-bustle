import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/src/constants/theme';
import type { PatternInsights } from '@/src/utils/patternEngine';

interface InsightCardData {
  key: string;
  title: string;
  body: string;
}

interface Props {
  insights: PatternInsights;
  dismissedKeys: string[];
  onDismiss: (key: string) => void;
}

const MAX_VISIBLE = 2;

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
    allCards.push({ key, title: 'Walk time updated', body });
  }

  for (const h of insights.departureHabits) {
    if (h.avgLatenessMinutes > 0) {
      const key = `habit_${h.classId}`;
      const mins = Math.abs(Math.round(h.avgLatenessMinutes));
      const body = `You tend to leave ${mins}min after we suggest — we've adjusted your alerts to account for this.`;
      allCards.push({ key, title: 'Departure habit noticed', body });
    }
  }

  for (const r of insights.routePreferences) {
    const key = `route_${r.context}`;
    const body = `You usually take Route ${r.preferredRoute} — we'll always show it first.`;
    allCards.push({ key, title: 'Route preference learned', body });
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
          <Text style={styles.sectionHeader}>Your patterns</Text>

          {visibleNew.map((card) => (
            <View key={card.key} style={styles.card}>
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle}>{card.title}</Text>
                <Text style={styles.cardBody}>{card.body}</Text>
              </View>
              <Pressable onPress={() => onDismiss(card.key)} hitSlop={8}>
                <Text style={styles.dismissBtn}>Got it</Text>
              </Pressable>
            </View>
          ))}

          {!showAllNew && hiddenNewCount > 0 && (
            <Pressable onPress={() => setShowAllNew(true)} style={styles.seeMoreBtn}>
              <Text style={styles.seeMoreText}>See {hiddenNewCount} more</Text>
            </Pressable>
          )}
        </>
      )}

      {dismissedCards.length > 0 && (
        <View style={styles.dismissedSection}>
          <Pressable
            onPress={() => setShowDismissed((v) => !v)}
            style={styles.dismissedToggle}
          >
            <Text style={styles.dismissedToggleText}>
              {showDismissed ? 'Hide' : `Show all ${dismissedCards.length} learning${dismissedCards.length > 1 ? 's' : ''}`} — About your commute
            </Text>
          </Pressable>

          {showDismissed &&
            dismissedCards.map((card) => (
              <View key={card.key} style={[styles.card, styles.cardDismissed]}>
                <View style={styles.cardContent}>
                  <Text style={[styles.cardTitle, styles.cardTitleDismissed]}>{card.title}</Text>
                  <Text style={[styles.cardBody, styles.cardBodyDismissed]}>{card.body}</Text>
                </View>
              </View>
            ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 8,
  },
  sectionHeader: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 16,
    color: theme.colors.navy,
    marginBottom: 10,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.orange,
    flexDirection: 'row',
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  cardDismissed: {
    borderLeftColor: theme.colors.border,
    opacity: 0.75,
  },
  cardContent: {
    flex: 1,
    marginRight: 10,
  },
  cardTitle: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
    color: theme.colors.navy,
    marginBottom: 4,
  },
  cardTitleDismissed: {
    color: theme.colors.textSecondary,
  },
  cardBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: theme.colors.textSecondary,
    lineHeight: 18,
  },
  cardBodyDismissed: {
    color: theme.colors.textMuted,
  },
  dismissBtn: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: theme.colors.orange,
    paddingTop: 2,
  },
  seeMoreBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    marginBottom: 8,
  },
  seeMoreText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: theme.colors.orange,
  },
  dismissedSection: {
    marginTop: 4,
  },
  dismissedToggle: {
    paddingVertical: 8,
    marginBottom: 4,
  },
  dismissedToggleText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
});
