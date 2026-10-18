import React from "react";
import { StyleSheet, View } from "react-native";
interface SelectLocationProps {
  setLocation: React.Dispatch<React.SetStateAction<string>>;
  setMode: React.Dispatch<
    React.SetStateAction<
      "initial" | "select-destination" | "select-start" | "done"
    >
  >;
  mode: "select-destination" | "select-start";
}

const SelectLocation: React.FC<SelectLocationProps> = ({
  setLocation,
  setMode,
  mode,
}) => {
  return <View></View>;
};
const styles = StyleSheet.create({});
export default SelectLocation;
