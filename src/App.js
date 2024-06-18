import React, { useState, useEffect } from "react";
import epub from "epubjs";
import ReactGA from "react-ga";

import "./App.scss";
import "./gradBG/gradBG.scss";
import AccessCode from "./AccessCode.js";
import About from "./About";
import { chatAPI, imageAPI, segmentAPI, downloadAPI } from "./utils/apiConfig.js";
import { initGradientBackground } from "./gradBG/gradBG.js";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import { mirage } from "ldrs";

mirage.register();

function App() {
  const [epubFile, setEpubFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [isAccessGranted, setIsAccessGranted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // const [estimatedWaitTime, setEstimatedWaitTime] = useState("");
  const [loadingInfo, setLoadingInfo] = useState("");

  // const payAPI = "https://visuaicalls.azurewebsites.net/api/stripe?code=iibdFb1TpBPK8jeOinKo7Bdw-YbioQ-FVLqTeBkbhK_xAzFuSC6dcA%3D%3D";

  const testMode = false;
  // const max_iterate = 2; // Set the desired maximum number of iterations

  const handleAccessGranted = () => {
    setIsAccessGranted(true);
  };

  const generatedBook = {
    title: "Generated Book_2",
    author: "Visuai",
    publisher: "Your Publisher",
    cover: "http://demo.com/url-to-cover-image.jpg",
    content: [],
  };

  useEffect(() => {
    ReactGA.initialize("G-74BZMF8F67");
    ReactGA.pageview(window.location.pathname + window.location.search);
    const cleanupGradientBackground = initGradientBackground();
    return () => cleanupGradientBackground();
  }, []);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      if (file.type === "application/epub+zip") {
        setEpubFile(file);
        setFileError("");
      } else {
        setEpubFile(null);
        setFileError("Please select a valid EPUB file.");
      }
    } else {
      setEpubFile(null);
      setFileError("No file selected.");
    }
  };

  const handleDownloadSampleBook = () => {
    ReactGA.event({
      category: "User",
      action: "Button Click",
      label: "Download Sample Book",
    });

    const sampleBookUrl = `${process.env.PUBLIC_URL}/The_Crystal_Throne.epub`;
    const link = document.createElement("a");
    link.href = sampleBookUrl;
    link.download = "The_Crystal_Throne.epub";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  //calls API to download the book.
  const handleDownloadBook = async () => {
    try {
      console.log("Downloading book...");
      setLoadingInfo("Downloading book...");
      console.log(generatedBook);
      // const response = await fetch("http://localhost:3001/download-book");
      const response = await fetch(downloadAPI, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(generatedBook),
      });
      console.log("Response status:", response.status);

      if (!response.ok) {
        console.error("Error downloading book:", response.statusText);
        setLoadingInfo("Error downloading the book.");
        return;
      }

      const blob = await response.blob();
      console.log("Blob size:", blob.size, "bytes");

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Visuai_${generatedBook.title}.epub`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setLoadingInfo("Book downloaded successfully!");
    } catch (error) {
      console.error("Error downloading the book:", error);
      setLoadingInfo("Error downloading the book.");
    } finally {
      setIsLoading(false);
    }
  };

  //Main/root function - When user clicks "Parse and Generate".. aka starts the flow and iterates through all chapters
  const handleParseAndGenerateImage = async () => {
    ReactGA.event({
      category: "User",
      action: "Button Click",
      label: "Start Generation",
    });

    setIsLoading(true);
    setLoadingInfo("Processing EPUB file...");

    if (!epubFile) {
      setLoadingInfo("No EPUB file selected. Please select a file.");
      setIsLoading(false);
      return;
    }

    try {
      console.log("Starting EPUB processing...");

      const epubReader = epub(epubFile);

      const metadata = await epubReader.loaded.metadata;

      generatedBook.title = metadata.title;
      generatedBook.author = metadata.creator;

      console.log(`Book title: ${generatedBook.title}`);

      const nav = await epubReader.loaded.navigation;
      const toc = nav.toc;

      const chapterBatch = [];

      let chapterCount = 0;
      for (let i = 0; i < toc.length; i++) {
        const chapter = toc[i];

        if (isNonStoryChapter(chapter.label)) continue;

        if (chapter.subitems && chapter.subitems.length > 0) {
          for (const subitem of chapter.subitems) {
            console.log(`Processing Chapter: ${chapterCount}`);
            chapterBatch.push(subitem);
            chapterCount++;
          }
        } else {
          console.log(`Processing Chapter: ${chapterCount}`);
          chapterBatch.push(chapter);
          chapterCount++;
        }
      }

      console.log("Starting chapter batch processing...");
      await processChapterBatch(chapterBatch, epubReader);

      handleDownloadBook();
    } catch (error) {
      console.error("Error while parsing EPUB:", error);
      setLoadingInfo("Error while parsing EPUB.");
    } finally {
      setIsLoading(false);
      console.log("Done processing book... queuing download");
    }
  };

  const processChapterBatch = async (chapterBatch, epubReader) => {
    const batchSize = 5; // Maximum number of concurrent API calls
    const delayMs = testMode ? 2000 : 62000; // 1 minute delay between batches (in milliseconds) or 2000 if testing

    console.log(`Total chapters to process: ${chapterBatch.length}`);

    const batchCount = Math.ceil(chapterBatch.length / batchSize);

    let chaptersProcessed = 0;

    for (let i = 0; i < chapterBatch.length; i += batchSize) {
      const batch = chapterBatch.slice(i, i + batchSize);
      console.log(`Processing batch ${i / batchSize + 1} of ${batchCount}`);

      const promises = batch.map((chapter, index) =>
        processChapter(chapter, index + i, epubReader)
      );

      await Promise.all(promises);
      console.log(`Batch ${i / batchSize + 1} processed successfully`);
      chaptersProcessed += batch.length;
      const processedPercentage = Math.round(
        (chaptersProcessed / chapterBatch.length) * 100
      );
      setLoadingInfo(
        `Processed ${processedPercentage}% of chapters... Please wait...`
      );

      // Check if successful generations have reached the limit

      if (i + batchSize < chapterBatch.length) {
        console.log("Waiting for 1 minute before the next batch...");
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  };

  // checks if the chapter is non-plot
  const isNonStoryChapter = (chapterLabel) => {
    const nonStoryLabels = [
      "Title Page",
      "Cover",
      "Dedication",
      "Contents",
      "Copyright",
      "Endorsements",
      "Introduction",
      "Author",
      "About",
      "Map",
    ];
    return nonStoryLabels.some((label) =>
      chapterLabel.toLowerCase().includes(label.toLowerCase())
    );
  };

  // reconstructs epub
  const addChapter = (chapterTitle, chapterText, imageUrl, chapterIndex) => {
    generatedBook.content[chapterIndex] = {
      title: chapterTitle,
      data:
        `<body id='master-body'> \n` +
        `<img src='${imageUrl}' /> \n` +
        `<p>${chapterText}</p> \n` +
        `</body>`,
    };
    // console.log('index: ' + chapterIndex);
  };
  const removeImages = (chapterText) => {
    const regex = /<img[^>]+>/g;
    const result = chapterText.replace(regex, "");
    return result;
  };

  //secondardy function: calls all of the generation pieces and constructs the books
  const processChapter = async (chapter, chapterIndex, epubReader) => {
    return new Promise(async (resolve, reject) => {
      try {
        // setIsLoading(true);
        const chapterPrompt = await getChapterText(chapter, epubReader);
        const chapterSegment = await findChapterSegment(chapterPrompt.text);

        if (chapterSegment !== "False" && !isNonStoryChapter(chapter.label)) {
          const processedPrompt = await generatePromptFromSegment(
            chapterSegment
          );

          let imageUrl = await generateImageFromPrompt(processedPrompt);
          if (imageUrl.startsWith("Error: ")) {
            console.error(imageUrl);
            imageUrl =
              "https://cdn.pixabay.com/photo/2017/02/12/21/29/false-2061132_640.png";
          }
          // I need to remove the images from the chapter text so the lame epub-generator can work it's magic in an azure environment.
          const cleanedBook = removeImages(chapterPrompt.html);
          addChapter(chapter.label, cleanedBook, imageUrl, chapterIndex);
        } else {
          // if the chapter is not a story, we will just add a default image. Removing the chapter is... messy
          console.log("Non-story: " + chapter.label);
          const cleanedBook = removeImages(chapterPrompt.html);
          const nonImageUrl =
            "https://cdn.pixabay.com/photo/2017/02/12/21/29/false-2061132_640.png";
          addChapter(chapter.label, cleanedBook, nonImageUrl, chapterIndex);
        }

        // setIsLoading(false);
        resolve(); // Resolve the promise when chapter processing is complete
      } catch (error) {
        reject(error); // Reject the promise if an error occurs
      }
    });
  };

  // Step1: Gets the text from the chapter
  const getChapterText = async (chapter, epubReader) => {
    const displayedChapter = await epubReader
      .renderTo("hiddenDiv")
      .display(chapter.href);
    const chapterPrompt = {
      html: displayedChapter.document.body.innerHTML,
      text: displayedChapter.contents.innerText.slice(0, 16000),
    };

    // console.log(chapterPrompt.html);
    return chapterPrompt;
  };

  // Step2: Takes the entire chapter as input and finds the best segment of text.
  const findChapterSegment = async (prompt) => {
    try {
      if (testMode === false) {
        const response = await fetch(segmentAPI, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        const data = await response.json();
        console.log("Segment: " + data.response);
        return data.response;
      } else {
        const resp = "ttttt";
        return resp;
      }
    } catch (error) {
      console.error("Error with ChatGPT API:", error);
      return "Chapter text invalid - try next chapter";
    }
  };

  // Step3: takes the segment of text and generates a DALL-E optimized prompt
  const generatePromptFromSegment = async (prompt) => {
    try {
      if (testMode === false) {
        const response = await fetch(chatAPI, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            bookTitle: generatedBook.title,
          }),
        });
        const data = await response.json();
        console.log("DALL-E Prompt: " + data.response);
        return data.response;
      } else {
        const resp = "ttttt";
        return resp;
      }
    } catch (error) {
      console.error("Error with ChatGPT API:", error);
      return "Chapter text invalid - try next chapter";
    }
  };

  // Step4: takes the prompt from OAI and calls DALL-E
  const generateImageFromPrompt = async (prompt) => {
    try {
      if (testMode === false) {
        console.log("generating image.. this can take up to 15s");
        const response = await fetch(imageAPI, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            size: "1792x1024",
            title: generatedBook.title,
          }),
        });
        const data = await response.json();
        if (data.error) {
          console.error("Error generating image:", data.error);
          ReactGA.event({
            category: "User",
            action: "Error",
            label: "Image generation failed",
          });
          return `Error: ${data.error}`;
        }
        ReactGA.event({
          category: "User",
          action: "Action Complete",
          label: "Image successfully generated",
        });

        return data.imageUrl;
      } else {
        const url =
          "https://www.outdoorpainter.com/wp-content/uploads/2015/04/f8b84457f79954b52239c255e44b3bb1.jpg";
        return url;
      }
    } catch (error) {
      console.error("Error calling the API:", error);
      ReactGA.event({
        category: "User",
        action: "Error",
        label: "Image generation failed",
      });
      return `Error: ${error.message}`;
    }
  };

  return (
    <Router>
      <div className="App">
        <div className="navbar">
          <Link to="/" className="link-button">
            <div className="logo-container">
              <img src="logo.png" alt="Visuai Logo" className="logo" />
              <h1>Visuai</h1>
            </div>
          </Link>
          <div className="nav-links">
            <Link to="/" className="nav-link">
              Home
            </Link>
            <Link to="/about" className="nav-link">
              About
            </Link>
            <button onClick={handleDownloadSampleBook} className="nav-link">
              Download an ePub
            </button>
            <a
              className="nav-link"
              href={`mailto:greg@visuai.io?subject=Issues%20Generating%20Book&body=-%20This%20was%20broken%3A%0A-%20This%20is%20how%20it%20should%20have%20worked%3A%0A-%20Images%20or%20console%20errors%20(optional)%3A`}
            >
              Issues?
            </a>
            <a className='nav-link' href="https://app.visuai.io" target="_blank" rel="noreferrer">
              Try V1
            </a>
          </div>
        </div>
        <div className="gradient-bg">
          <svg xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="goo">
                <feGaussianBlur
                  in="SourceGraphic"
                  stdDeviation="10"
                  result="blur"
                />
                <feColorMatrix
                  in="blur"
                  mode="matrix"
                  values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8"
                  result="goo"
                />
                <feBlend in="SourceGraphic" in2="goo" />
              </filter>
            </defs>
          </svg>
          <div className="gradients-container">
            <div className="g1"></div>
            <div className="g2"></div>
            <div className="g3"></div>
            <div className="g4"></div>
            <div className="g5"></div>
            <div className="interactive"></div>
          </div>
        </div>
        <div className="content-container">
          <Routes>
            <Route path="/about" element={<About />} />
            <Route
              path="/"
              element={
                <>
                  <div className="header-container">
                    <h1>Turn Words in Worlds</h1>
                    {isAccessGranted ? (
                      <div id="headings">
                        <h4>
                          Add illustations to your full ePub - Free for a
                          limited time
                        </h4>
                        <div className="control-container">
                          <div className="input-container">
                            {/* <div className="file-input-wrapper"> */}
                            <input
                              type="file"
                              accept=".epub"
                              onChange={handleFileChange}
                            />
                            {/* </div> */}
                            {fileError && (
                              <p className="error-message">{fileError}</p>
                            )}
                          </div>
                          {epubFile && (
                            <div className="button-container">
                              <button
                                id="parse"
                                onClick={handleParseAndGenerateImage}
                              >
                                <FontAwesomeIcon icon={faWandMagicSparkles} />
                                Visualize
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <AccessCode onAccessGranted={handleAccessGranted} />
                    )}
                    {isLoading ? (
                      <div>
                        <br></br>
                        <l-mirage
                          size="111"
                          speed="2.9"
                          color="#CDB8FF"
                        ></l-mirage>
                      </div>
                    ) : null}
                    <p>{loadingInfo}</p>
                  </div>
                  <div id="hiddenDiv"></div>
                </>
              }
            />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
