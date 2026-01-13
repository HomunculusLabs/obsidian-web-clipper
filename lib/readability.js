/*! Simplified Readability for Obsidian Web Clipper */
/* Based on Mozilla's Readability - simplified version for Chrome extension */

(function(global) {
  'use strict';

  /**
   * Simplified Readability implementation for article extraction
   * This is a minimal version focused on extracting main content from web pages
   */
  function Readability(doc, options) {
    this._doc = doc;
    this._articleTitle = '';
    this._articleByline = '';
    this._articleDir = '';
    this._articleSiteTitle = '';
    this._experiments = [];
    this._articlePublishedTime = null;
    this._articleModifiedTime = null;
    this._articleContent = null;
    this._article_excerpt = null;

    this.options = Object.assign({
      debug: false,
      maxElemsToParse: options && options.maxElemsToParse || this._DEFAULT_MAX_ELEMS_TO_PARSE,
      nbTopCandidates: options && options.nbTopCandidates || this._DEFAULT_N_TOP_CANDIDATES,
      charThreshold: options && options.charThreshold || this._DEFAULT_CHAR_THRESHOLD,
      classesToPreserve: options && options.classesToPreserve || [],
      keepClasses: false,
      serializer: function(el) {
        return el.innerHTML;
      },
      disableJSONLD: false
    }, options);
  }

  Readability.prototype = {
    _DEFAULT_MAX_ELEMS_TO_PARSE: 0,
    _DEFAULT_N_TOP_CANDIDATES: 5,
    _DEFAULT_CHAR_THRESHOLD: 500,

    /**
     * Run readability on the document
     */
    parse: function() {
      // Avoid parsing too large documents
      if (this._doc.documentElement.outerHTML.length > 2500000) {
        if (!this.options.maxElemsToParse) {
          this.options.maxElemsToParse = this._DEFAULT_MAX_ELEMS_TO_PARSE;
        }
      }

      // Extract metadata
      this._articleTitle = this._getTitle();
      this._articleByline = this._getByline();
      this._articleSiteTitle = this._getSiteTitle();
      this._extractPublishedDate();
      this._extractExcerpt();

      // Extract article content
      const articleContent = this._grabArticle();

      if (!articleContent) {
        return null;
      }

      // Clean up the article content
      this._postProcessContent(articleContent);

      return {
        title: this._articleTitle || '',
        content: this.options.serializer(articleContent),
        textContent: articleContent.textContent,
        length: articleContent.textContent.length,
        excerpt: this._article_excerpt || '',
        byline: this._articleByline || '',
        dir: this._articleDir,
        siteName: this._articleSiteTitle || '',
        publishedTime: this._articlePublishedTime || null,
        modifiedTime: this._articleModifiedTime || null
      };
    },

    /**
     * Get the article title
     */
    _getTitle: function() {
      const doc = this._doc;
      let title = '';

      // Try various sources for the title
      if (typeof title === 'undefined') {
        title = doc.querySelector('title')?.textContent?.trim() || '';
      }

      // Use Open Graph title if available
      const ogTitle = doc.querySelector('meta[property="og:title"]');
      if (ogTitle) {
        return ogTitle.getAttribute('content')?.trim() || title;
      }

      // Use h1 if available and title seems incomplete
      const h1 = doc.querySelector('h1');
      if (h1 && title.length < 3) {
        title = h1.textContent.trim();
      }

      return title;
    },

    /**
     * Get the article author/byline
     */
    _getByline: function() {
      const doc = this._doc;
      let byline = '';

      // Try meta author
      const metaAuthor = doc.querySelector('meta[name="author"]');
      if (metaAuthor) {
        byline = metaAuthor.getAttribute('content');
      }

      // Try schema.org author
      const schemaAuthor = doc.querySelector('[itemprop="author"]');
      if (schemaAuthor) {
        byline = byline || schemaAuthor.textContent?.trim();
      }

      return byline || '';
    },

    /**
     * Get the site title
     */
    _getSiteTitle: function() {
      const doc = this._doc;
      let siteTitle = '';

      const metaSite = doc.querySelector('meta[property="og:site_name"]');
      if (metaSite) {
        siteTitle = metaSite.getAttribute('content');
      }

      return siteTitle;
    },

    /**
     * Extract published date
     */
    _extractPublishedDate: function() {
      const doc = this._doc;

      // Try various meta tags for published date
      const dateMeta = [
        'meta[property="article:published_time"]',
        'meta[property="article:published"]',
        'meta[name="article:published_time"]',
        'meta[name="date"]',
        'meta[name="pubdate"]',
        'meta[name="publish_date"]',
        'meta[itemprop="datePublished"]'
      ];

      for (const selector of dateMeta) {
        const meta = doc.querySelector(selector);
        if (meta) {
          this._articlePublishedTime = meta.getAttribute('content');
          break;
        }
      }
    },

    /**
     * Extract excerpt/description
     */
    _extractExcerpt: function() {
      const doc = this._doc;

      // Try meta description
      const metaDesc = doc.querySelector('meta[name="description"]');
      if (metaDesc) {
        this._article_excerpt = metaDesc.getAttribute('content');
        return;
      }

      // Try Open Graph description
      const ogDesc = doc.querySelector('meta[property="og:description"]');
      if (ogDesc) {
        this._article_excerpt = ogDesc.getAttribute('content');
      }
    },

    /**
     * Grab the article content from the page
     */
    _grabArticle: function() {
      const doc = this._doc;

      // Remove unlikely elements
      this._prepDocument();

      // Find the content node
      const articleTitle = this._articleTitle;
      const root = this._doc.body;

      // Score all paragraphs
      const paragraphs = root.querySelectorAll('p, pre, td');
      const candidates = [];

      for (let i = 0; i < paragraphs.length; i++) {
        const parentNode = paragraphs[i].parentNode;
        const grandParentNode = parentNode ? parentNode.parentNode : null;
        const innerText = paragraphs[i].textContent.trim();

        if (!innerText || innerText.length < 25) {
          continue;
        }

        if (!parentNode || parentNode.tagName === 'TABLE') {
          continue;
        }

        // Initialize candidate scoring
        if (!candidates[parentNode.hashCode]) {
          candidates[parentNode.hashCode] = this._initializeNode(parentNode);
        }

        if (!grandParentNode || grandParentNode.tagName === 'TABLE') {
          continue;
        }

        if (!candidates[grandParentNode.hashCode]) {
          candidates[grandParentNode.hashCode] = this._initializeNode(grandParentNode);
        }

        // Score based on content
        const contentScore = this._scoreNode(paragraphs[i], innerText);

        candidates[parentNode.hashCode].score += contentScore;
        candidates[grandParentNode.hashCode].score += contentScore / 2;
      }

      // Find top candidates
      const topCandidates = [];
      for (const key in candidates) {
        topCandidates.push(candidates[key]);
      }

      topCandidates.sort((a, b) => b.score - a.score);

      if (topCandidates.length === 0) {
        return null;
      }

      // Get the best candidate
      let topCandidate = topCandidates[0];
      const articleContent = topCandidate.element;

      // Clean up the content
      return this._cleanContent(articleContent);
    },

    /**
     * Initialize a node for scoring
     */
    _initializeNode: function(node) {
      return {
        element: node,
        score: 0,
        hashCode: this._hashCode(node)
      };
    },

    /**
     * Get a simple hash code for an element
     */
    _hashCode: function(element) {
      if (element._hashCode) {
        return element._hashCode;
      }
      element._hashCode = Math.random().toString(36).substring(2);
      return element._hashCode;
    },

    /**
     * Score a node based on its content
     */
    _scoreNode: function(node, text) {
      let score = 0;

      // Length score
      score += Math.min(text.length / 100, 3);

      // Bonus for commas and periods (indicates sentences)
      score += (text.match(/,/g) || []).length * 0.5;
      score += (text.match(/\./g) || []).length * 1;

      // Class name bonuses
      const className = node.className || '';
      if (/article|body|content|entry|main|page/.test(className)) {
        score += 2;
      }
      if (/post|text|blog|story/.test(className)) {
        score += 1;
      }

      // ID bonuses
      const id = node.id || '';
      if (/article|body|content|entry|main|page/.test(id)) {
        score += 2;
      }

      return score;
    },

    /**
     * Prepare the document for parsing
     */
    _prepDocument: function() {
      const doc = this._doc;

      // Remove scripts, styles, and other non-content elements
      const toRemove = [
        'script',
        'style',
        'link',
        'iframe',
        'nav',
        'footer',
        'header',
        'aside',
        '.ad',
        '.advertisement',
        '.sidebar',
        '.comments',
        '.comment',
        '.navigation',
        '.menu',
        '.social',
        '.share',
        '.cookie',
        '.popup',
        '.modal',
        '.newsletter',
        '[role="complementary"]',
        '[role="navigation"]'
      ];

      toRemove.forEach(selector => {
        const elements = doc.querySelectorAll(selector);
        for (let i = 0; i < elements.length; i++) {
          elements[i].remove();
        }
      });

      // Remove elements with certain classes/IDs
      const unlikelyPatterns = [
        /ad|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|foot|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplement|ad-break|agegate|pagination|pager|popup|sub-sidebar/i,
        /print|archive|comment|article|discussion|email|share|login|signup|feedback/i
      ];

      const allElements = doc.querySelectorAll('*');
      for (let i = 0; i < allElements.length; i++) {
        const el = allElements[i];
        const className = el.className || '';
        const id = el.id || '';

        let isUnlikely = false;
        for (const pattern of unlikelyPatterns) {
          if (pattern.test(className) || pattern.test(id)) {
            // Skip if also has positive patterns
            if (!/article|body|content|entry|main|post|text/.test(className + ' ' + id)) {
              isUnlikely = true;
              break;
            }
          }
        }

        if (isUnlikely) {
          el.remove();
        }
      }
    },

    /**
     * Clean the article content
     */
    _cleanContent: function(element) {
      // Clone to avoid modifying original
      const clone = element.cloneNode(true);

      // Remove remaining unwanted elements
      const toRemove = clone.querySelectorAll(
        'script, style, link, iframe, nav, footer, .ad, .advertisement, .comments, .sidebar'
      );
      for (let i = 0; i < toRemove.length; i++) {
        toRemove[i].remove();
      }

      return clone;
    },

    /**
     * Post-process the content
     */
    _postProcessContent: function(articleContent) {
      // Remove empty paragraphs
      const emptyParagraphs = articleContent.querySelectorAll('p, div');
      for (let i = 0; i < emptyParagraphs.length; i++) {
        const el = emptyParagraphs[i];
        if (!el.textContent.trim() && !el.querySelector('img')) {
          el.remove();
        }
      }
    }
  };

  // Export for different module systems
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Readability;
  } else if (typeof define === 'function' && define.amd) {
    define(function() { return Readability; });
  } else {
    global.Readability = Readability;
  }

})(typeof window !== 'undefined' ? window : this);
