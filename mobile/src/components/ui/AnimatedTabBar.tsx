/**
 * AnimatedTabBar — custom bottom tab bar with a springy orange pill that
 * glides under the active tab, bouncing icons, and haptic feedback.
 */
import { theme } from "@/src/constants/theme";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SPRING = { damping: 16, stiffness: 180, mass: 0.8 };

function TabIcon({
  focused,
  icon,
  label,
}: {
  focused: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  const scale = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    scale.value = withSpring(focused ? 1 : 0, SPRING);
  }, [focused, scale]);
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + scale.value * 0.18 }, { translateY: -scale.value * 2 }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + scale.value * 0.45,
  }));
  return (
    <View style={styles.tabContent}>
      <Animated.View style={iconStyle}>{icon}</Animated.View>
      <Animated.Text style={[styles.tabLabel, labelStyle, focused && styles.tabLabelActive]} numberOfLines={1}>
        {label}
      </Animated.Text>
    </View>
  );
}

export function AnimatedTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);
  const tabCount = state.routes.length;
  const slotWidth = tabCount > 0 ? barWidth / tabCount : 0;

  const indicatorX = useSharedValue(0);
  const indicatorOpacity = useSharedValue(0);
  useEffect(() => {
    if (slotWidth > 0) {
      indicatorX.value = withSpring(state.index * slotWidth, SPRING);
      indicatorOpacity.value = withTiming(1, { duration: theme.motion.base });
    }
  }, [state.index, slotWidth, indicatorX, indicatorOpacity]);

  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: indicatorOpacity.value,
    transform: [{ translateX: indicatorX.value }],
  }));

  return (
    <View style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <LinearGradient
        colors={[theme.gradients.ember[0], theme.gradients.ember[1]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.bar} onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}>
        {/* Gliding pill indicator */}
        {slotWidth > 0 && (
          <Animated.View style={[styles.indicator, { width: slotWidth }, indicatorStyle]}>
            <View style={styles.indicatorPill} />
          </Animated.View>
        )}
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label = typeof options.title === "string" ? options.title : route.name;
          const focused = state.index === index;
          const color = focused ? theme.colors.orangeBright : "rgba(255,255,255,0.5)";
          const icon = options.tabBarIcon?.({ focused, color, size: 22 });

          return (
            <Pressable
              key={route.key}
              style={styles.tab}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              testID={options.tabBarButtonTestID}
              onPress={() => {
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  navigation.navigate(route.name, route.params);
                }
              }}
              onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
            >
              <TabIcon focused={focused} icon={icon} label={label} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    overflow: "hidden",
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    backgroundColor: theme.colors.navyDeep,
    ...theme.shadows.lg,
  },
  bar: {
    flexDirection: "row",
    height: 62,
    alignItems: "stretch",
  },
  indicator: {
    position: "absolute",
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 6,
  },
  indicatorPill: {
    width: 44,
    height: 32,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(232,74,39,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,107,61,0.35)",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tabContent: {
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  tabLabel: {
    fontFamily: "DMSans_500Medium",
    fontSize: 10,
    color: "rgba(255,255,255,0.55)",
  },
  tabLabelActive: {
    color: theme.colors.orangeBright,
    fontFamily: "DMSans_600SemiBold",
  },
});
