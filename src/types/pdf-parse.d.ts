declare module 'pdf-parse' {
  type PdfParseResult = {
    text: string;
    numpages: number;
  };

  function pdfParse(data: Buffer): Promise<PdfParseResult>;

  export = pdfParse;
}
