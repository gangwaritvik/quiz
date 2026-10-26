"""Lab 12: Selenium WebDriver UI test suite for SecureQuiz.

Run against a server with development OTP mode on (the login screen then shows the code):

    pip install selenium
    python tests/selenium/test_securequiz.py            # app on http://localhost:3000

Environment: SQ_BASE (default http://localhost:3000), SQ_SHOTS (screenshot folder).
The tests run in order and share one browser: a student journey, then a faculty journey.
"""
import os
import re
import time
import unittest

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

BASE = os.environ.get("SQ_BASE", "http://localhost:3000")
SHOTS = os.environ.get("SQ_SHOTS", os.path.join(os.path.dirname(__file__), "shots"))
STUDENT = "23CSE012"
FACULTY = "anita.raghavan@college.edu"


class SecureQuizUITest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.makedirs(SHOTS, exist_ok=True)
        opts = webdriver.ChromeOptions()
        opts.add_argument("--headless=new")
        opts.add_argument("--window-size=1280,900")
        cls.driver = webdriver.Chrome(options=opts)
        # Light theme, so the screenshots print well in a report.
        cls.driver.execute_cdp_cmd(
            "Emulation.setEmulatedMedia",
            {"features": [{"name": "prefers-color-scheme", "value": "light"}]},
        )
        cls.wait = WebDriverWait(cls.driver, 15)

    @classmethod
    def tearDownClass(cls):
        cls.driver.quit()

    # ---------- helpers ----------
    def shot(self, name):
        self.driver.save_screenshot(os.path.join(SHOTS, f"{name}.png"))

    def text(self):
        return self.driver.find_element(By.TAG_NAME, "body").text

    def open(self, path):
        self.driver.get(BASE + path)

    def request_code(self, identifier):
        """Step 1 of sign-in: enter the identifier, press Send OTP, return the on-screen dev code."""
        d = self.driver
        self.open("/login")
        self.wait.until(EC.visibility_of_element_located((By.ID, "identifier"))).send_keys(identifier)
        d.find_element(By.XPATH, "//button[contains(., 'Send OTP')]").click()
        self.wait.until(EC.text_to_be_present_in_element((By.TAG_NAME, "body"), "Enter your code"))
        found = re.search(r"Your code is\s*(\d{6})", self.text())
        return found.group(1) if found else None

    def enter_code(self, code):
        first = self.driver.find_element(By.CSS_SELECTOR, "input[aria-label='Digit 1 of 6']")
        first.click()
        first.send_keys(code)

    def sign_in(self, identifier, landing):
        code = self.request_code(identifier)
        self.assertIsNotNone(code, "development code is shown on screen")
        self.enter_code(code)
        self.wait.until(EC.url_contains(landing))

    def sign_out(self):
        self.driver.find_element(By.CSS_SELECTOR, "[aria-label='Account menu']").click()
        self.wait.until(EC.element_to_be_clickable((By.XPATH, "//*[contains(text(), 'Sign out')]"))).click()
        self.wait.until(EC.url_contains("/login"))

    # ---------- student journey ----------
    def test_01_login_page(self):
        self.open("/login")
        self.assertIn("SecureQuiz", self.driver.title)
        self.assertIn("Sign in", self.driver.find_element(By.TAG_NAME, "h1").text)
        self.shot("01_login")

    def test_02_unknown_account_looks_the_same(self):
        self.request_code("ZZ9999")  # must not reveal that the account does not exist
        self.assertIn("Enter your code", self.text())
        self.shot("02_unknown_account")

    def test_03_wrong_code_is_rejected(self):
        type(self).student_code = self.request_code(STUDENT)  # reused by the next test: a resend is blocked for 30 s
        self.assertIsNotNone(self.student_code, "development code is shown on screen")
        self.enter_code("000000")
        self.wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "[role='alert']")))
        self.assertIn("/login", self.driver.current_url)
        self.shot("03_wrong_code")

    def test_04_student_signs_in(self):
        # Same page, same code as the previous test: clear the wrong digits and type the right ones.
        for box in self.driver.find_elements(By.CSS_SELECTOR, "input[aria-label^='Digit']"):
            box.clear()
        self.enter_code(self.student_code)
        self.wait.until(EC.url_contains("/dashboard"))
        self.assertIn("Dashboard", self.driver.find_element(By.TAG_NAME, "h1").text)
        self.shot("04_student_dashboard")

    def test_05_student_sees_results(self):
        self.open("/results")
        self.wait.until(EC.presence_of_element_located((By.TAG_NAME, "h1")))
        self.assertIn("Results", self.driver.find_element(By.TAG_NAME, "h1").text)
        self.shot("05_student_results")

    def test_06_student_blocked_from_admin(self):
        self.open("/admin")
        time.sleep(1)
        self.assertNotIn("Integrity Reports", self.text())
        self.assertNotRegex(self.driver.current_url, r"/admin/?$")
        self.shot("06_student_blocked")

    def test_07_student_signs_out(self):
        self.open("/dashboard")
        self.sign_out()
        self.open("/dashboard")
        self.wait.until(EC.url_contains("/login"))
        self.shot("07_student_signed_out")

    # ---------- faculty journey ----------
    def test_08_faculty_signs_in(self):
        self.sign_in(FACULTY, "/admin")
        self.assertIn("Dashboard", self.driver.find_element(By.TAG_NAME, "h1").text)
        self.shot("08_faculty_dashboard")

    def test_09_question_bank(self):
        self.open("/admin/questions")
        self.wait.until(EC.text_to_be_present_in_element((By.TAG_NAME, "body"), "Question bank"))
        self.assertIn("Database Systems", self.text())
        self.shot("09_question_bank")

    def test_10_quiz_list(self):
        self.open("/admin/quizzes")
        self.wait.until(EC.text_to_be_present_in_element((By.TAG_NAME, "body"), "Quizzes"))
        self.assertGreater(len(self.driver.find_elements(By.CSS_SELECTOR, "a[href^='/admin/quizzes/']")), 0)
        self.shot("10_quiz_list")

    def test_11_integrity_queue(self):
        self.open("/admin/integrity")
        self.wait.until(EC.text_to_be_present_in_element((By.TAG_NAME, "body"), "Integrity"))
        self.assertIn("Ananya Desai", self.text())  # seeded attempt with integrity signals
        self.shot("11_integrity")

    def test_12_faculty_signs_out(self):
        self.sign_out()
        self.open("/admin")
        self.wait.until(EC.url_contains("/login"))
        self.shot("12_faculty_signed_out")


if __name__ == "__main__":
    unittest.main(verbosity=2)
