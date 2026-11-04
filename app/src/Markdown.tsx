import { Fragment } from "react";
import { Text, View } from "react-native";
import { styles, colors } from "./theme";
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).map((part, i) =>
    part.startsWith("**") ? (
      <Text key={i} style={{ fontWeight: "700" }}>
        {part.slice(2, -2)}
      </Text>
    ) : part.startsWith("`") ? (
      <Text key={i} style={{ fontFamily: "Menlo", backgroundColor: colors.background }}>
        {part.slice(1, -1)}
      </Text>
    ) : part.startsWith("*") ? (
      <Text key={i} style={{ fontStyle: "italic" }}>
        {part.slice(1, -1)}
      </Text>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
/** Deliberately small Markdown subset: no HTML, embedded images, or executable links. */
function parseLines(value: string) {
  let fenced = false;
  return value.split("\n").map((line) => {
    if (line.startsWith("```")) {
      fenced = !fenced;
      return { line: "", kind: "delimiter" };
    }
    return { line, kind: fenced ? "code" : "text" };
  });
}
export default function Markdown({ children }: { children: string }) {
  return (
    <View style={{ gap: 8 }}>
      {parseLines(children).map(({ line, kind }, i) => {
        if (kind === "delimiter") return null;
        if (kind === "code")
          return (
            <Text
              selectable
              key={i}
              style={[styles.text, { fontFamily: "Menlo", fontSize: 13 }]}
            >
              {line}
            </Text>
          );
        const heading = line.match(/^(#{1,3})\s+(.*)$/);
        if (heading)
          return (
            <Text
              key={i}
              style={[styles.title, { fontSize: 26 - heading[1].length * 2 }]}
            >
              {inline(heading[2])}
            </Text>
          );
        return (
          <Text key={i} style={styles.text}>
            {inline(line.replace(/^[-*]\s+/, "• "))}
          </Text>
        );
      })}
    </View>
  );
}
