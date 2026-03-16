"use client";

import { useRef } from "react";
import Link from "next/link";
import {
  Mic,
  Brain,
  ScanLine,
  Volume2,
  Eye,
  GraduationCap,
  Linkedin,
  Instagram,
  Github,
  ArrowRight,
} from "lucide-react";
import Footer from "@/components/layout/Footer";
import { useAuth } from "@/context/AuthContext";
import { motion, useInView } from "framer-motion";

const features = [
  {
    icon: Mic,
    title: "Real-time Lecture Recording",
    desc: "Record lectures directly in your browser. Audio is transcribed in real-time using AssemblyAI—never miss a word.",
    gradient: "from-violet-500 to-purple-600",
  },
  {
    icon: Brain,
    title: "AI Content Transformation",
    desc: "Powered by Gemini 2.5 Flash, your lecture content is instantly converted into simplified notes, flashcards, quizzes, and mindmaps.",
    gradient: "from-purple-500 to-fuchsia-500",
  },
  {
    icon: ScanLine,
    title: "Handwriting Analysis",
    desc: "Snap a photo of handwritten notes and let AI digitize, extract, and structure the content automatically.",
    gradient: "from-amber-500 to-orange-500",
  },
  {
    icon: Volume2,
    title: "Read Aloud (TTS)",
    desc: "Multilingual text-to-speech with live word highlighting. Supports English, Hindi, and Kannada with adjustable speed.",
    gradient: "from-emerald-500 to-teal-500",
  },
  {
    icon: Eye,
    title: "Dyslexia-Friendly Interface",
    desc: "OpenDyslexic font, adjustable line spacing, high contrast themes, and customizable text size—built for accessibility first.",
    gradient: "from-pink-500 to-rose-500",
  },
  {
    icon: GraduationCap,
    title: "Smart Study Tools",
    desc: "AI-generated flashcards, interactive quizzes, and visual mindmaps help reinforce learning and improve retention.",
    gradient: "from-sky-500 to-blue-500",
  },
];

const teamMembers = [
  {
    name: "Pushkar R Deshpande",
    role: "Team Lead and Frontend Developer",
    focus: "UI and Product Experience",
    college: "4th Sem EIE, BIT Bangalore",
    accent: "from-blue-500 to-cyan-500",
    linkedin:
      "https://www.linkedin.com/in/pushkar-r-deshpande-510177334?utm_source=share&utm_campaign=share_via&utm_content=profile&utm_medium=android_app",
    instagram: "https://www.instagram.com/pushkar__deshpande?igsh=MWdwbmlwcDF4amUwcg==",
    github: "https://github.com/pushkarrd",
  },
  {
    name: "Hemsagar B C",
    role: "Backend Developer",
    focus: "Backend Systems and APIs",
    college: "4th Sem EIE, BIT Bangalore",
    accent: "from-emerald-500 to-teal-500",
    linkedin:
      "https://www.linkedin.com/in/hemsagar-b-c-b2610a318?utm_source=share&utm_campaign=share_via&utm_content=profile&utm_medium=android_app",
    instagram: "https://www.instagram.com/hemsagar_36?igsh=dWcxa3pteG5kcWdr",
    github: "https://github.com/Hemsagar-BC",
  },
];

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.1 },
  }),
};

export default function Landing() {
  const { currentUser } = useAuth();
  const featuresRef = useRef(null);
  const isInView = useInView(featuresRef, { once: true, margin: "-100px" });

  return (
    <div className="min-h-screen home-page">
      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex flex-col items-center justify-center px-6 sm:px-8 md:px-12 py-20 text-center">
        <div className="max-w-4xl w-full">
          <motion.h1
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black mb-8 leading-tight text-foreground"
          >
            Make Every Lecture{" "}
            <span className="gradient-text">Easy to Understand</span> —
            Instantly.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg sm:text-xl md:text-2xl mb-10 leading-relaxed text-muted-foreground font-medium max-w-3xl mx-auto"
          >
            NeuroLex helps students with dyslexia and reading challenges by
            turning complex lectures into clear, simple, and accessible notes in
            real time.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center"
          >
            {currentUser ? (
              <Link href="/dashboard">
                <button className="px-10 py-4 rounded-full font-semibold text-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl hover:shadow-violet-500/25">
                  Go to Dashboard
                  <ArrowRight className="inline ml-2 w-5 h-5" />
                </button>
              </Link>
            ) : (
              <Link href="/login">
                <button className="px-10 py-4 rounded-full font-semibold text-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl hover:shadow-violet-500/25">
                  Try NeuroLex Now
                  <ArrowRight className="inline ml-2 w-5 h-5" />
                </button>
              </Link>
            )}
            <a href="#features">
              <button className="px-10 py-4 rounded-full font-semibold text-lg glass border border-border text-foreground hover:bg-accent transition-all">
                Learn More
              </button>
            </a>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section
        id="features"
        className="py-24 md:py-32 px-6 sm:px-8 md:px-12"
        ref={featuresRef}
      >
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16 md:mb-20"
          >
            <h2 className="text-4xl sm:text-5xl md:text-6xl font-black mb-6 leading-tight text-foreground">
              Designed for Everyone
            </h2>
            <p className="text-lg md:text-xl max-w-2xl mx-auto text-muted-foreground">
              Features built specifically for students with dyslexia and reading
              challenges
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                custom={i}
                initial="hidden"
                animate={isInView ? "visible" : "hidden"}
                variants={fadeUp}
                whileHover={{ scale: 1.03, y: -4 }}
                className="group glass-card rounded-2xl p-8 md:p-10 transition-all duration-300 hover:shadow-xl focus-dimmable"
              >
                <div
                  className={`mb-5 flex justify-center`}
                >
                  <div
                    className={`p-3 rounded-xl bg-gradient-to-br ${f.gradient} shadow-lg`}
                  >
                    <f.icon className="w-8 h-8 text-white" />
                  </div>
                </div>
                <h3 className="text-2xl md:text-3xl font-bold mb-4 text-foreground text-center">
                  {f.title}
                </h3>
                <p className="text-base md:text-lg leading-relaxed text-muted-foreground text-center">
                  {f.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section id="team" className="py-24 md:py-28 px-6 sm:px-8 md:px-12">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-14"
          >
            <h2 className="text-4xl sm:text-5xl md:text-6xl font-black mb-5 leading-tight text-foreground">
              Meet the Team
            </h2>
            <p className="text-lg md:text-xl max-w-2xl mx-auto text-muted-foreground">
              Built with care by a focused two-member team driving NeuroLex from idea to prototype.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            {teamMembers.map((member, index) => (
              <motion.div
                key={member.name}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                whileHover={{ scale: 1.02, y: -4 }}
                className="glass-card rounded-2xl p-7 md:p-8 transition-all duration-300"
              >
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-2xl font-bold text-foreground">{member.name}</h3>
                    <p className="text-sm md:text-base font-semibold text-muted-foreground mt-1">
                      {member.role}
                    </p>
                  </div>
                  <div className={`h-3 w-20 rounded-full bg-gradient-to-r ${member.accent}`} />
                </div>

                <p className="text-sm md:text-base text-muted-foreground mb-2">{member.focus}</p>
                <p className="text-xs md:text-sm text-muted-foreground/90 mb-5">{member.college}</p>

                <div className="flex gap-3">
                  <a
                    href={member.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                    aria-label={`${member.name} GitHub`}
                  >
                    <Github className="w-4 h-4" /> GitHub
                  </a>
                  <a
                    href={member.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                    aria-label={`${member.name} LinkedIn`}
                  >
                    <Linkedin className="w-4 h-4" /> LinkedIn
                  </a>
                  <a
                    href={member.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                    aria-label={`${member.name} Instagram`}
                  >
                    <Instagram className="w-4 h-4" /> Instagram
                  </a>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 md:py-32 px-6 sm:px-8 md:px-12 text-center">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="glass-card rounded-3xl shadow-2xl p-12 md:p-16"
          >
            <h2 className="text-4xl sm:text-5xl md:text-6xl font-black mb-8 leading-tight text-foreground">
              Ready to Transform Your Learning?
            </h2>
            <p className="text-lg md:text-xl mb-10 md:mb-12 leading-relaxed text-muted-foreground">
              Join thousands of students who are already experiencing better
              understanding and retention with NeuroLex.
            </p>
            <Link href="/dashboard">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-10 py-4 rounded-full font-semibold text-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl hover:shadow-violet-500/25"
              >
                Try NeuroLex
                <ArrowRight className="inline ml-2 w-5 h-5" />
              </motion.button>
            </Link>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
