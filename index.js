/**
 * @format
 */

import { AppRegistry } from 'react-native';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Navigation from './Navigation'; // Use Navigation as root
import { name as appName } from './app.json';

// Wrap Navigation component with SafeAreaProvider
const Root = () => (
  <SafeAreaProvider>
    <Navigation />
  </SafeAreaProvider>
);

// Register the Root component as main app
AppRegistry.registerComponent(appName, () => Root);
