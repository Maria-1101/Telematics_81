import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import App from './App'; // your current map screen
import ExpandedMapView from './ExpandedMapView'; // the screen to navigate to

// Define the param list type (should match the one in App.tsx)
export type RootStackParamList = {
  MainScreen: undefined;
  ExpandedMapView: {
    targetLocation: [number, number];
    locationData: {
      placeName: string;
      placeAddress: string;
    };
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function Navigation() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="MainScreen">
        <Stack.Screen 
          name="MainScreen" 
          component={App} 
          options={{ title: 'Hello User,' }} 
        />
        <Stack.Screen 
          name="ExpandedMapView" 
          component={ExpandedMapView} 
          options={{ title: 'Map' }} 
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}