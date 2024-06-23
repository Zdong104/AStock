import { Tabs } from 'expo-router';
import React from 'react';

import { TabBarIcon } from '@/components/navigation/TabBarIcon';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
      }}>
      <Tabs.Screen
        name="Kevin" // File name, need to update in tsconfig as well.
        options={{
          title: '总裁专用', // Display name
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name={focused ? 'home' : 'home-outline'} color={color} /> // Icon name
          ),
        }}
      />
      <Tabs.Screen
        name="Questions"
        options={{
          title: 'Questions',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name={focused ? 'help-circle' : 'help-circle-outline'} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
