declare module "ansi-to-svg" {
  interface AnsiToSvgOptions {
    fontFace?: string;
    fontSize?: number;
    lineHeight?: number;
    scale?: number;
    paddingTop?: number;
    paddingLeft?: number;
    paddingBottom?: number;
    paddingRight?: number;
    colors?: string | Record<string, string>;
  }
  function ansiToSvg(ansiText: string, options?: AnsiToSvgOptions): string;
  export = ansiToSvg;
}
